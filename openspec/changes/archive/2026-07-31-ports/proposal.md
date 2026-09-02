# ports: межфичевое общение через контракты

## Why

Сегодня фичи в одном процессе общаются единственным способом — через общий
контейнер: `deps: [BillingService]`, синхронный вызов, общая транзакция.
Это ровно та связность, которая превращает модульный монолит в
**распределённый монолит** в день, когда `select` разводит фичи по процессам:
call-site придётся переписывать, потому что у него нет ни async-границы, ни
Fail-канала, ни адреса.

Целевое состояние ([`contracts.md`](../../../docs/design/contracts.md) §1–§3)
разрешает противоречие «location transparency vs no runtime magic» так:
**индиректность резолвится на сборке, а не на запросе**. Контракт —
направление-нейтральное значение; владелец его реализует, потребитель инжектит
`Contract.port` / `Contract.emitter` и зовёт константу. Какая именно константа
(co-located или поверх шины) — решает composition root, зная топологию и
политику диспатча.

Половина работы уже сделана предыдущими волнами и переиспользуется целиком:
inbound-сторона порта — **буквально endpoint** (дискавери из дерева модулей #8,
`dispatch`/`serve` #10, pipeline и страж границы #4/#15, capability-проверка
форм #6), а `Topic` из #6 — готовый broadcast-примитив для in-proc шины.
Новое здесь — **только исходящая сторона** и правило её биндинга.

Логика решений зафиксирована в `docs/decisions/ideas.md`, секция
«[2026-07-08] Порты: межфичевое общение через контракты»; разбор —
[`docs/history/discussions/05-modular-monolith-features-ports.md`](../../../docs/history/discussions/05-modular-monolith-features-ports.md)
§3–§4. Это change #11 из [roadmap](../../../docs/decisions/roadmap.md), первый
в волне 5, размер L. Его предпосылки закрыты волной 4: `assemble` с фазовым
lifecycle и go-live (#10), `Topic` (#6), закрытый контракт отказов (#15),
тестовый корень (#18), словарь политик (#28). На него опираются
`port-deadline-idempotency` (#27), `contract-versioning` (#26),
`transport.nats` (#12), `contract-clients` (#22) и остаток `testing-package`
(`stub(Contract)`, `app.emit`).

## What Changes

- **`makeContract({ name, kind, input?, output?, errors? })`** — контракт как
  значение с тремя видами: `request` (req-reply, Fail-able, ровно один
  владелец), `command` (fire-and-forget, ровно один обработчик, реплики делят
  нагрузку queue-group'ой), `event` (broadcast, 0..N подписчиков). Имя —
  адрес: оно же subject шины, оно же ключ дискавери; повторное имя — ошибка в
  точке создания.
- **`implement(Contract, { deps?, pipeline?, handle, subscriber? })`** —
  реализация контракта как обычная декларация-значение на транспорте шины:
  кладётся в `endpoints:` модуля и наследует **всю** существующую машинерию —
  дискавери, `dispatch`, pipeline и страж границы, policy-check,
  `assembleTest().call()`. Новой оси регистрации не появляется.
- **`Contract.port` / `Contract.emitter`** — инжектируемые вызыватели, члены
  token-семейств: `port.call(input, meta?): Promise<Ok<O> | Fail<E ∪ UnknownError>>`
  и `emitter.emit(payload, meta?): Promise<void>`. Вызыватель материализуется
  на `build()` **только для запрошенных** контрактов (on-demand-члены,
  d/05 §15). `.port` существует только у `request`, `.emitter` — только у
  `command`/`event`; ошибка вида ловится компилятором и продублирована
  fail-fast'ом.
- **Биндинг решается на ASSEMBLE**, а не на запросе: (топология co-located
  реализаций из дискавери) × (политика диспатча) → конкретный клиент-константа.
  Позднее связывание есть ровно одно и оно явное: local-клиент получает
  `dispatch` шины на фазе WIRE (вызов до WIRE — внятная ошибка, а не пустой
  вызов), потому что до WIRE исполнимых ручек не существует ни у кого.
- **`IMessageBus`** (`request` / `publish` / `subscribe` — LCD NATS-глаголов) и
  **`InProcessBus`**: одно значение с двумя способностями — `ITransport`
  (inbound: `serve(dispatch, signal)`, подписка на subjects своих маршрутов) и
  `IMessageBus` (outbound). Broadcast построен на `Topic` из `@nestling/streams`.
  Способности шины по формам io — **только value**: контракт со `stream`/
  `events` отвергается на ASSEMBLE существующей проверкой capability.
- **Политики диспатча `local-first` и `always-remote`** — выбираются
  **конфигом**, не кодом: секция `nestling.ports`, читаемая примордиально
  (фаза 0), до графа. `always-remote` в V1 — не поднятый брокер, а in-proc
  симуляция провода: async-барьер плюс структурная копия payload, то есть
  честная репетиция split'а в dev и в тестах.
- **Отказ ре-гидрируется по `code`** — один нормализатор «ответ → `Ok | Fail`»
  для local- и remote-пути: код из закрытого множества `errors:` контракта
  восстанавливается в настоящий `Fail`, незадекларированный — в `UnknownError`.
  Тип call-site у co-located и split идентичен до последнего дженерика; это
  тот вклад в модель ошибок, который #15 явно оставил портам.
- **Дисциплина, выраженная кодом, а не документом**: `call`/`emit` всегда
  async и Fail-able даже co-located; порт не участвует в транзакции вызывающего
  (вызов уходит в собственный request-scope); `request`/`command` без
  co-located реализации при отсутствии remote-шины — ошибка **сборки**, а не
  рантайма.

## Non-goals

- **NATS-транспорт** — change `transport.nats` (#12): queue-groups по проводу,
  JetStream/`durable`, wire-часть `propagate` из #16 и relative timeout из #27.
  Здесь фиксируется только `IMessageBus` как LCD и точка выбора шины на сборке.
- **`meta.deadline` и `idempotencyKey`** — change `port-deadline-idempotency`
  (#27). `meta` порта в этом change несёт только `signal`; форма словаря
  выбирается так, чтобы оба поля встали рядом без переделки call-site.
- **Порт на контракт с формами `stream`/`events`** — в V1 это fail-fast на
  ASSEMBLE (способности шины — только value-формы). Стриминг по шине — v2.
- **Политика `balanced`** (client-side spill) — единственная из трёх, что
  требует решения **в рантайме** и метрик, которых без настоящей remote-шины
  не существует. После #12; call-site от её появления не меняется — это и есть
  проверка того, что политика действительно конфиг.
- **Версионирование контрактов и схемный дифф** — change `contract-versioning`
  (#26). Здесь версия — просто часть имени (`user.create.v2`), машинерии нет.
- **`stub(Contract, impl)` и `app.emit`** — остаток `testing-package` (#18),
  волна 6. Реализации контрактов тестируются уже существующим `app.call` по
  идентичности декларации.
- **HTTP-биндинг контракта (`http:`) и `makeClient`** — change
  `contract-clients` (#22). Контракт в этом change адресуется только именем
  шины; bind-карта и внешний клиент приезжают позже, к уже существующему
  значению.
- **Zero-runtime-deps упаковка контрактов** — `makeContract` живёт в новом
  `@nestling/ports`, а не в `@nestling/pipeline` (как предупреждает roadmap).
  Выделение `@nestling/operations` без DI- и pipeline-зависимостей требует
  переезда `Ok`/`Fail`/`defineFail` и делается в #22, где у него есть
  потребитель (`@nestling/client`).
- **Outbox/saga** — отложены ([deferred](../../../docs/decisions/deferred.md)).
  Кросс-фичевая согласованность в V1 — события, а не общая транзакция.

## Capabilities

### New Capabilities

- `contract-declarations`: `makeContract` как значение — три вида и их
  семантика; имя как адрес и как ключ идентичности (повтор — ошибка создания);
  `input`/`output`/`errors` и их проверки в точке создания; `.port`/`.emitter`
  как токены-члены семейств, доступные по виду контракта; отсутствие побочных
  эффектов сверх регистрации имени.
- `contract-implementations`: `implement(Contract, …)` как конструктор
  декларации поверх `makeEndpoint`; `pattern` и subject; `subscriber:` —
  обязателен для `event` и запрещён для `request`/`command`; ровно один
  владелец у `request`/`command` и fail-fast на втором; участие реализации в
  дискавери, `dispatch`, policy-check и `app.call` наравне с HTTP-ручкой.
- `port-invocation`: форма вызова `port.call(input, meta?)` → `Promise<Ok | Fail>`
  и `emitter.emit(payload, meta?)` → `Promise<void>`; идентичность типа
  call-site для co-located и split; валидация `input`/`output` по схемам
  контракта на обоих путях; ре-гидрация отказа по `code` и `UnknownError` для
  незадекларированного; `meta.signal` и отмена; отсутствие транзакционности и
  собственный request-scope вызова.
- `port-binding`: биндинг как решение фазы ASSEMBLE — топология co-located
  реализаций × политика диспатча; политика из конфиг-секции `nestling.ports`,
  прочитанной примордиально; `local-first` и `always-remote` (in-proc
  симуляция провода: async-барьер + структурная копия); материализация
  вызывателя только для запрошенных контрактов; связывание local-клиента с
  `dispatch` на WIRE и ошибка вызова до WIRE; fail-fast'ы сборки (нет
  реализации `request`/`command`, форма io вне способностей шины).
- `message-bus`: `IMessageBus` как LCD (`request`/`publish`/`subscribe`) и
  граница, за которую NATS-специфика не протекает; `InProcessBus` как одно
  значение с двумя способностями (`ITransport` + `IMessageBus`); broadcast
  поверх `Topic`; доставка `command` ровно одному подписчику и `event` — всем;
  способности по формам io (только value); отсутствие `durable` в V1.

### Modified Capabilities

- `composition-root`: `assemble` регистрирует kernel-модуль портов (как
  `configKernel`/`contextKernel`) и передаёт ему топологию, вычисленную
  дискавери; политика диспатча читается примордиально в фазе 0 рядом с
  `select`; перечень полей `assemble` при этом **не** пополняется.
- `lifecycle-phases`: WIRE дополняется шагом связывания local-портов с
  `dispatch` шины — после `makeDispatch` и до START; вызов порта раньше WIRE
  SHALL быть внятной ошибкой.
- `endpoint-declarations`: `implement(Contract, …)` встаёт рядом с
  `httpEndpoint`/`cliEndpoint` как конструктор деклараций поверх того же
  kernel-примитива; онтология «конструктор = сахар анонимный контракт +
  implement» перестаёт быть только словами в дизайне.
- `endpoint-error-contract`: закрытое множество `E ∪ UnknownError`
  распространяется на call-site порта — граница ре-гидрирует отказ по `code`,
  а не отдаёт `ErrorDetails` наружу.

## Impact

- **Новый пакет `@nestling/ports`** — `makeContract`, `implement`,
  `Port`/`Emitter` (семейства и типы вызывателей), `IMessageBus`,
  `inProcessBus()` (провайдер), `portsKernel()`, секция конфига `nestling.ports`.
  Зависимости: `@nestling/container`, `@nestling/pipeline`,
  `@nestling/transport`, `@nestling/streams`, `@nestling/config`.
- **`@nestling/app`** — регистрация kernel-модуля портов, примордиальное чтение
  политики, шаг связывания портов в WIRE, топология из дискавери; публичный
  перечень полей `assemble` не меняется.
- **`@nestling/pipeline`** — точек изменения минимум: `makeEndpoint`
  переиспользуется как есть; при необходимости уточняется типизация `binding`
  для шины.
- **`packages/examples.app-with-http`** — витрина L3: две фичи, общающиеся
  контрактом (`request` + `event`), и переключение политики диспатча конфигом
  без правки call-site.
- **Документация** — `docs/design/contracts.md` уточняется по факту
  реализованного (форма `implement`, шаг WIRE, состав V1-политик), запись в
  `docs/decisions/ideas.md` о принятых здесь решениях, новый гайд
  `docs/guides/ports.md`, README нового пакета и `@nestling/app`, статус
  change #11 в roadmap.
