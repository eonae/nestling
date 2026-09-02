## Why

Контракт уже порождает двух потребителей — реализацию (`implement`) и
внутреннего вызывателя (`.port`/`.emitter`). Третьего, **внешнего**
потребителя (фронт, сервис на другом стеке, скрипт) не существует: DI ему
недоступен, а HTTP-адреса в контракте нет — `name` это адрес шины. Логика
и целевой дизайн зафиксированы в
[ideas.md [2026-07-13] «Типизированные клиенты из контрактов»](../../../docs/decisions/ideas.md),
дискуссия — [d/07](../../../docs/history/discussions/07-typed-clients.md),
change #22 из [roadmap](../../../docs/decisions/roadmap.md).

Все предпосылки закрыты: `makeContract` (#11), `defineFail`/`errors:` (#15),
`~standard.validate` (#19), плоская bind-карта (#21). Дыра ровно одна и
закрывается сейчас.

## What Changes

- **Новый пакет `@nestling/operations`** — дом направление-нейтральных
  деклараций: `makeContract`, `defineFail`, `Fail`/`Ok` и словарь статусов,
  формы io (`stream`/`events`/`multipart`/`upload`), пометки `query()`/`body()`
  и вычисление bind-карты. Граф импортов пакета не содержит ни серверного
  кода, ни контейнера, ни Node-специфики: внешних runtime-зависимостей нет
  (транзитивно только типы `@standard-schema/spec`).
- **Секция `http:` в контракте** — `http: 'POST /users/:id'` либо развёрнуто
  `{ method, path, bind?, rawBody?, sse? }`. Канон разворачивается в плоскую
  bind-карту **в момент `makeContract`** с fail-fast — карта обязана быть
  выводима из значения, которое импортирует клиент, без серверного кода.
- **Контракт-форма `httpEndpoint({ contract, … })`** — серверная сторона
  того же значения: путь, схемы и `errors:` берутся из контракта,
  переобъявление их — ошибка компиляции (симметрия с `implement`). Без неё
  `http:` был бы декларацией адреса, который никто не обязан обслуживать, —
  ровно тот разъезд двух артефактов, из-за которого отвергнут `httpBind()`.
- **Новый пакет `@nestling/client`** — `makeClient(record, { baseUrl, headers?,
  fetch? })` → API-объект: потребитель сам именует методы, call-site
  эквивалентен вызывателю контракта его вида. Запрос собирается по bind-карте
  (обратная операция к strict-приёму транспорта), ответ валидируется по
  `output`-схеме через `~standard.validate`, отказ рематериализуется по `code`
  из `errors:`; незадекларированный код → `UnknownError`, то есть контракт
  `E ∪ UnknownError` закрыт симметрично серверной границе.
- **Перенос, а не дублирование.** Пере­ехавшие символы остаются в публичной
  поверхности прежних пакетов реэкспортом (`@nestling/pipeline` — `Fail`,
  `Ok`, `defineFail`, статусы, формы io); `makeContract` из `@nestling/ports`
  **не** реэкспортируется — это воспроизвело бы ровно ту ошибку упаковки, из-за
  которой контракт нельзя было импортировать во фронт. Примеры и гайды
  переводятся на канонический импорт.
- Закрываются два открытых вопроса записи: валидация ответа — **по умолчанию**
  (opt-out `validateOutput: false`); коерсия провод-строк на клиенте —
  скаляры и массивы скаляров, всё остальное в query — ошибка в момент вызова.

## Non-goals

- **Streaming-клиент** (`stream` → NDJSON `AsyncIterable`, `events` → SSE +
  `Last-Event-ID`) — отдельно и позже, вместе с AsyncAPI. Контракт с потоковой
  формой io отвергается `makeClient` с fail-fast.
- **Кодогенерация** TS-клиента вместо вывода типов из контракта; путь для
  не-TS-потребителей остаётся через `@nestling/openapi` (change #20).
- **Per-call заголовки** (`header()`) — отложены, см.
  [deferred.md](../../../docs/decisions/deferred.md); ambient-заголовки живут
  в конфиге создания клиента.
- **Клиент по шине** (NATS-клиент вне процесса) — у шины уже есть
  `@nestling/transport.nats`; `makeClient` это HTTP.
- **Смена формы `.port`/`.emitter`** и любая правка семантики портов:
  переезжает физический дом кода, публичное поведение — нет.
- **`makeEndpoint`/анонимный `httpEndpoint`** остаются инлайн-формой без
  клиента — осознанное ограничение, а не пробел.

## Capabilities

### New Capabilities

- `contract-http-binding`: секция `http:` контракта — форма записи,
  разворачивание канона в плоскую bind-карту в момент `makeContract`,
  fail-fast словаря, доступность карты из одного импорта.
- `typed-http-client`: `makeClient(record, config)` — форма API-объекта,
  сборка запроса по bind-карте, валидация ответа по `output`, рематериализация
  `Fail` по `code`, закрытый контракт `E ∪ UnknownError`, fail-fast создания.
- `contracts-package-boundary`: пакетная граница деклараций —
  `@nestling/operations` как единственный дом, отсутствие серверного кода и
  внешних runtime-зависимостей в графе импортов, политика реэкспортов.

### Modified Capabilities

- `contract-declarations`: словарь `makeContract` принимает `http:`; проверки
  секции — в момент создания контракта; дом примитива — `@nestling/operations`.
- `http-input-binding`: точка разворачивания карты — создание **контракта**
  наравне с созданием декларации; пометки `query()`/`body()` экспортируются
  из `@nestling/operations` (реэкспорт из `@nestling/transport.http`
  сохраняется).
- `endpoint-declarations`: `httpEndpoint` получает контракт-форму
  (`{ contract, handle }`), в которой `method`/`path`/`bind`/`input`/`output`/
  `errors` принадлежат контракту и переобъявлению не подлежат.

## Impact

**Новые пакеты:** `packages/nestling.operations`, `packages/nestling.client`.

**Затронутый код:**

- `@nestling/pipeline` — из пакета уезжают `core/result.ts`, `core/status.ts`,
  `core/define-fail.ts`, `core/kernel-fails.ts` и декларативный слой
  `core/io/` (`forms`, `io`, `summary`, `assert`, `capabilities`); рантайм
  (`bind-stream`, сам pipeline, страж границы) остаётся. Публичная поверхность
  сохраняется реэкспортом.
- `@nestling/ports` — из пакета уезжают `contract.ts`, `registry.ts` и
  семейства вызывателей; остаются `implement`, шина, kernel, профиль,
  совместимость, снапшоты.
- `@nestling/container` — добавляется subpath-экспорт `./tokens`
  (`common.ts` + `token-family.ts` — оба листовые модули без runtime-импортов),
  чтобы `@nestling/operations` получал примитив токена, не втягивая билдер
  графа и `@common/graphs`.
- `@nestling/transport.http` — декларативная половина `binding.ts` (пометки,
  тип карты, `computeHttpBinding`) уезжает в `@nestling/operations`;
  потребляющая половина (`assemblePayload`, `readQuery`, `bindingNeedsBody`,
  `httpBindingOf`) остаётся. Уходит зависимость карты от типа `HTTPMethod`
  пакета `find-my-way`.
- `packages/examples.app-with-http` — контракты обзаводятся `http:`, появляется
  клиентский скрипт-потребитель; `packages/examples.split-nats` — правится
  импорт `makeContract`.

**Документация:** `docs/design/contracts.md` (секция `http:` и внешний
потребитель), `docs/design/errors.md` (рематериализация по проводу),
`docs/design/schemas.md` (валидация ответа клиентом), новый гайд
`docs/guides/typed-client.md`, запись в `docs/decisions/ideas.md` (решения по
двум открытым вопросам, пакетная граница, контракт-форма `httpEndpoint`),
статус в `docs/decisions/roadmap.md`.

**Размер:** roadmap оценивает change как M; по факту это **L** — цена вынесена
не в новую логику, а в физический переезд декларативного слоя между пакетами,
без которого «импортируем во фронт» остаётся обещанием, а не гарантией.
