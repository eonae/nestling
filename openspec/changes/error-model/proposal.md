# error-model: модель ошибок — `Fail` как значение, закрытый контракт

## Why

Модель ошибок сегодня расходится на трёх уровнях. Превью документации
обещает Result-семантику (`return charge`, `charge.isFail`); типы её не
знают — `Output<T> = Promise<Ok<T> | T>`, `Fail` в возврате не участвует,
поля `isFail` не существует; рантайм (`normalizeResponse` в
`packages/nestling.pipeline/src/core/pipeline.ts:564`) знает только
`instanceof Ok`, поэтому **возвращённый `Fail` уезжает клиенту как `200 OK`
с сериализованным телом ошибки** — это баг, а не недоделка.

Сверх того словарь `ErrorStatus` дырявый и HTTP-скошенный (нет `CONFLICT`,
`TIMEOUT`, `TOO_MANY_REQUESTS` — пример в превью вынужден писать
`Fail.badRequest('Email already taken')` про конфликт), у `Fail` нет ни
стабильного машинного `code`, ни `cause`, а доменного слоя ошибок нет
вовсе: все бросают анонимные `Fail.notFound('...')`, и множество ответов
ручки остаётся конвенцией, которую клиент угадывает по факту.

Решение зафиксировано в `docs/decisions/ideas.md`, секция
«[2026-07-10] Модель ошибок: Fail — значение, code-идентичность,
`defineFail`, ошибки в контракте», и описано как целевое состояние в
[`docs/design/errors.md`](../../../docs/design/errors.md). Это change #15
из [roadmap](../../../docs/decisions/roadmap.md) — первый в волне 3
(семантика ядра); breaking-окно волны 2 закрыто, поэтому форма публичного
API уже устойчива, а `errors:` в декларации — предпосылка для `openapi`
(#20), `ports` (#11) и `contract-clients` (#22).

## What Changes

- **`Fail` — значение на обоих путях. BREAKING (баг-фикс).**
  `normalizeResponse` отправляет возвращённый `Fail` на error-track **до**
  `.ok`-юнитов: возврат отказа становится эквивалентен броску, инвариант
  «`.ok` видит только успех» держится для обоих путей. Сегодня такой ответ
  уходит как `200 OK` — код, случайно опиравшийся на это, сломается
  громко и по делу.
- **Дискриминант `isFail`.** `Fail.isFail: true`, `Ok.isFail: false` —
  сериализуемая проверка вместо `instanceof` (на проводе класс мёртв,
  поле выживает). `Output<T, E>` и `OutputSync<T, E>` включают `Fail`.
- **Словарь статусов пополняется**: `CONFLICT`, `TIMEOUT`,
  `TOO_MANY_REQUESTS` (маппинг на HTTP — 409/504/429). Статус остаётся
  транспортно-нейтральной семантикой; перевод на провод — забота
  транспорта.
- **`code` и `cause` у `Fail`.** `code` — стабильный машинный код («что
  именно случилось»), ось, ортогональная статусу («как отвечать
  транспорту»); `cause` — обёртывание исходной ошибки (ES2022). На проводе
  (`ErrorDetails`) появляется `code`.
- **`defineFail` — доменные ошибки как значения.** `defineFail('CODE', {
  status, message, details? })` даёт фабрику-конструктор, предикат
  `.is(value)` и брендированный тип `Fail<'CODE', Details>`. Идентичность —
  **по `code`, не по `instanceof`**: отказ, приехавший по проводу, — это
  данные.
- **`errors:` в декларации endpoint'а** (`makeEndpoint` и транспортные
  конструкторы) — типизированный канал отказов. Из него выводится `E`:
  `handle` получает `Output<T, E>` (вернуть незадекларированный `Fail`
  нельзя — ошибка компиляции) и **второй зарезервированный ключ meta —
  `meta.fail(e: E): never`**: типизированный ранний выход, принимающий
  только задекларированные отказы.
- **Страж на границе пайплайна.** Всё, что доехало до границы
  незадекларированным (прямой `throw`, отказ из глубины сервисов,
  JS-обход типов), **нормализуется в `UnknownError`** — встроенный
  `defineFail('UNKNOWN')` со статусом `INTERNAL_ERROR`; оригинал уходит в
  диагностический хук целиком, клиенту — generic-тело. Никакого
  warn-and-pass. Страж стоит **после всех `.catch`-юнитов**: `.catch` —
  легальное место, где недекларированный отказ становится контрактным.
  Итог — ответ ручки есть **закрытое множество `E ∪ UnknownError`**.
- **Kernel-коды.** Встроенные отказы фреймворка (`UNKNOWN`,
  `VALIDATION_FAILED` у `validate()`-middleware) входят в закрытое
  множество неявно, без декларации: иначе страж превратил бы штатный 400
  валидации в 500. Список закрыт и растёт только вместе с ядром (у портов
  к нему добавится `DEADLINE_EXCEEDED` — change #27).
- **Миграция примеров и гайдов.** `packages/examples.*` переходят с
  анонимных `Fail.notFound(...)` на `defineFail` + `errors:`; гайды
  пересверяются.

### Non-goals

- **Ре-гидрация remote-`Fail` по проводу** — приезжает с change #11
  `ports` (и `makeClient` — #22). Здесь фиксируется только то, что делает
  её возможной: `code`-идентичность и сериализуемый дискриминант.
- **Wire-формат RFC 9457 (`application/problem+json`)** — отложен,
  см. [deferred.md](../../../docs/decisions/deferred.md). Тело ответа
  остаётся текущим `ErrorDetails`, к нему добавляется `code`.
- **Унификация тел ошибок, порождённых транспортом вне пайплайна**
  (400 парсинга JSON, 413 лимитов): они не проходят через страж и
  сохраняют текущий формат — их приведение едет вместе с wire-форматом.
  Единственное исключение — отказ валидации схемы: код
  `VALIDATION_FAILED` проставляется на обоих путях, чтобы один и тот же
  концерн не отвечал двумя разными телами.
- **Автозаполнение `requestId` в теле ошибки** — требует асинхронного
  контекста (change #16); поле кладётся `.catch`/`.finally`-юнитом
  пользователя, ядро его не изобретает.
- **Раскладка `errors:` в OpenAPI-responses** — change #20 `openapi`.
  Здесь декларация только собирается и становится доступной как значение.
- **`Fail` посреди стрима** — к change #6 `streaming-v2`; семантика
  отказа внутри уже начатого потока в V1 не обещается.
- **`throws:`-декларации провайдеров и графовая проверка** — отвергнуты
  в журнале: гарантию даёт нормализация на границе, а не церемония на
  каждом провайдере.
- **Иерархия классов исключений + декораторы** (`@Exception`/`@Throws`) —
  отвергнуты там же: чужеродны values-идиоме, `instanceof` не переживает
  провод.

## Capabilities

### New Capabilities

- `error-values`: `Fail` и `Ok` как значения — сериализуемый дискриминант
  `isFail`, эквивалентность «возврат ≡ бросок» в рантайме пайплайна,
  `Output<T, E>`/`OutputSync<T, E>`, семантический словарь статусов
  (включая `CONFLICT`/`TIMEOUT`/`TOO_MANY_REQUESTS`), поля `code`/`cause`
  и их представление в теле ответа.
- `domain-fail-definitions`: `defineFail` — фабрика доменных отказов,
  идентичность по `code` (`.is()` вместо `instanceof`), брендированный тип
  `Fail<'CODE', Details>`, схема `details`, реестр встроенных
  kernel-кодов (`UNKNOWN`, `VALIDATION_FAILED`) и правило их неявного
  вхождения в контракт.
- `endpoint-error-contract`: `errors:` в словаре декларации, вывод `E` в
  `handle` (`Output<T, E>`), зарезервированный ключ `meta.fail(e): never`,
  страж на границе пайплайна (нормализация незадекларированного в
  `UnknownError` после `.catch`-юнитов, диагностический хук для
  оригинала) и закрытость множества ответов `E ∪ UnknownError`.

### Modified Capabilities

- `error-response-safety`: требование «Fail responses are not affected»
  сужается — раскрытие `message`/`details` без `exposeErrorDetails`
  остаётся привилегией **задекларированного** отказа; незадекларированный
  `Fail` нормализуется в `UnknownError` и отдаёт generic-тело, а оригинал
  уходит в диагностический хук. Тело ошибки получает `code`.
- `pipeline-phase-model`: требование «Исполнение одного слоя» дополняется
  веткой возвращённого `Fail` (error-track до `.ok`-юнитов) и стражем
  после ответного тракта — до вычисления исхода для `.finally`.
- `endpoint-declarations`: словарь декларации принимает `errors:`
  (список определений `defineFail`); конструктор проверяет его при
  создании (дубли кодов, не-определения) наравне с остальным словарём.
- `endpoint-handler-di`: все три формы `handle` получают `meta.fail`,
  типизированный декларацией; сигнатура сверяется со списком `errors:`
  в точке декларации так же, как сегодня со схемами `input`/`output`.
- `http-request-validation-errors`: отказ валидации несёт kernel-код
  `VALIDATION_FAILED`, проходит страж без нормализации и сохраняет 400;
  тело дополняется полем `code`.

## Impact

**Публичный API (BREAKING):**
- `Output<T>`/`OutputSync<T>` получают второй тип-параметр и допускают
  `Fail` в возврате; сигнатуры `HandlerFn` меняются (появляется `E` и
  `meta.fail`).
- Возвращённый `Fail` перестаёт быть `200 OK` — поведение меняется у
  любого кода, который на это опирался.
- Незадекларированный `Fail`, доехавший до границы, отвечает 500
  `UNKNOWN` вместо прежнего собственного статуса: все ручки, бросающие
  ad-hoc `Fail.*`, обязаны либо задекларировать отказ, либо оформить его
  в `.catch`.
- `Fail` становится генериком по `code`/`details`; `class Fail extends
  Error` и статические фабрики (`Fail.notFound` и прочие) сохраняются.

**Код:** `packages/nestling.pipeline` — `src/core/result.ts` (Ok/Fail,
`Output`), `src/core/status.ts` (словарь), `src/core/pipeline.ts`
(`normalizeResponse`, `errorToResponse`, страж, инъекция `meta.fail`),
`src/core/types/context.ts` (`ErrorDetails.code`, `EndpointMeta.errors`),
`src/core/types/endpoint.ts` (`HandlerFn`), `src/metadata/endpoint.ts`
(`errors:`, проверка словаря), `src/middlewares/validate.ts`
(kernel-код), новый модуль `defineFail`; `packages/nestling.transport.http`
(`STATUS_MAP` + перенос `errors` в `EndpointMeta`),
`packages/nestling.transport.cli` (то же), `packages/nestling.app`
(перенос `errors` при дискавери, если требуется).

**Примеры и доки:** `packages/examples.app-with-http`,
`packages/examples.simple-http-server`, `packages/examples.simple-cli` —
переход на `defineFail` + `errors:`; `docs/guides/*` (пересверка с датой
плашки), `docs/design/errors.md` и `docs/design/endpoints.md` (сверка с
реализацией), `docs/preview` (пример с `Fail.badRequest` про конфликт),
README `@nestling/pipeline`, `docs/decisions/roadmap.md` (статус #15).

**Зависимости:** новых внешних нет. Апстрим — вся волна 2 (форма
деклараций и `Output` устоялись). Даунстрим — #6 `streaming-v2`
(отказ в стриме), #11 `ports` (ре-гидрация по `code`), #20 `openapi`
(`errors:` → responses), #22 `contract-clients` (рематериализация),
#27 (`DEADLINE_EXCEEDED` как kernel-код).
