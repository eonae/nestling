# Roadmap доработок до целевого состояния

План работ по приведению кода к целевому дизайну из [ideas.md](./ideas.md).
Каждая строка — отдельный OpenSpec change (`openspec/changes/<имя>/`);
статус обновляется по ходу (это живой документ, в отличие от append-only
журнала решений).

Составлен 2026-07-06 по итогам аудита и серии архитектурных сессий;
дополнен 2026-07-08 (changes 8–13) по сессии модульного монолита —
логика в [discussions/05](../history/discussions/05-modular-monolith-features-ports.md);
14–18 добавлены 2026-07-10, 19–20 — 2026-07-13 по записям в [ideas.md](./ideas.md);
21–22 — 2026-07-13 по дизайну типизированных клиентов
([d/07](../history/discussions/07-typed-clients.md));
23–27 — 2026-07-13 по итогам критического ревью, пп. 5–7
([d/06](../history/discussions/06-critical-design-review.md)); 24
(`endpoint-model`) детализирован дискуссией
[d/08](../history/discussions/08-endpoint-declarations-and-styles.md);
28 — 2026-07-14 по записи «Policy-check на собранном графе» (закрывает
d/06 П.3). Состав breaking-окна фиксации публичного API V1 закрыт:
17, 19, 21, 23, 24 ([ideas.md [2026-07-14]](./ideas.md) «Kernel 1.0»).
29 и 30 добавлены 2026-09-01 — первые change'ы после закрытия волны 6:
29 по записи [ideas.md [2026-08-29]](./ideas.md) о проверке входа рантаймом,
30 по записи [ideas.md [2026-09-01]](./ideas.md) «Модуль без `exports`».

| # | Change | Суть | Размер | Статус |
|---|---|---|---|---|
| 1 | `transport-hardening` | утечка stack trace в 500-ответах, лимит body, таймауты, 400 вместо 500 для ошибок входа, дренаж `close()` | S | **done** — [архив](../../openspec/changes/archive/2026-07-07-transport-hardening/) |
| 2 | `container-fixes` | module-метаданные функциональных провайдеров, накопление lifecycle-метаданных per-instance, JSDoc `get()` | S | **done** — [архив](../../openspec/changes/archive/2026-07-07-container-fixes/) |
| 3 | `abort-signal` | `meta.signal` (AbortSignal) насквозь: транспорт (дисконнект) + App (shutdown) | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-07-abort-signal/) |
| 4 | `pipeline-v2` | фазы `.pre/.ok/.catch/.after/.finally`, `makePipeline`, слои + `compose`, `TNeeds`, рантайм-тесты ядра | L, breaking | **done** — [архив](../../openspec/changes/archive/2026-07-13-pipeline-v2/) |
| 5 | `token-families` | `makeTokenFamily`, `.auto`, `familyProvider`; ~~опционально `strictExports`~~ — СУПЕРСИД 2026-09-01 (change `remove-module-exports`). **Покрывает и конфиг (`Config(key)`), и on-demand-клиенты (`GrpcClient(server)` + unbound properties)** — см. [discussions/05 §15](../history/discussions/05-modular-monolith-features-ports.md#15) | M | **done** — [архив](../../openspec/changes/archive/2026-07-29-token-families/) |
| 6 | `streaming-v2` | `stream` ≠ `events`, item-цепочки на io-декларации, `Topic`, `summary`, SSE; io-декларация как дерево форм (`value`/`stream`/`events`/`multipart` + `upload()`, листья — Standard Schema), поэлементная валидация; capability-валидация биндинга: формы контракта vs способности транспорта, fail-fast на ASSEMBLE | L | **done** — [архив](../../openspec/changes/archive/2026-07-31-streaming-v2/), [ideas.md [2026-07-06]](./ideas.md), новый пакет [`@nestling/streams`](../../packages/nestling.streams/) |
| 7 | `subscriptions-registry` | пакет реестра подписок поверх signal + finish-хуков (dogfooding публичных примитивов): слой `tracked` из двух класс-юнитов, `meta.subscription.signal` = `AbortSignal.any(запрос, админский)`, `CloseReason = Outcome \| 'killed'`, лента на `Topic`, факты `event`-контрактами (opt-in), параметризованный модуль; ядро не тронуто ни строкой | M | **done** — новый пакет [`@nestling/subscriptions`](../../packages/nestling.subscriptions/), [гайд](../guides/subscriptions.md), отчёт о замере [ideas.md [2026-08-01]](./ideas.md) |
| 8 | `endpoint-discovery` | эндпоинты и транспорты — дискавери из дерева зарегистрированных модулей вместо глобального registry (чинит протечку глобального `Set` при любом импорте). Предпосылка фич | S | **done** — [архив](../../openspec/changes/archive/2026-07-29-endpoint-discovery/), [d/05 §1](../history/discussions/05-modular-monolith-features-ports.md) |
| 9 | `config-module` | `makeConfig('prefix', schema)` + `from`; источники = объекты `ConfigSource` в одной приватной читалке (env — база, координаты из примордиального env); приватность = keys-capability (токен секции не экспортируется, наружу — branded-хэндл `.keys`; без `configs:`-регистрации и build()-проверки владения); привязка в корне плоским списком `config: [[src, keys \| glob]]`; reloadable (`Topic`/`AbortSignal`, живой хэндл); on-demand/unbound + доки из реестра (тег фичи из графа + флаг). Поверх `token-families` (5) | M–L | **done** — [архив](../../openspec/changes/archive/2026-07-31-config-module/), новый пакет [`@nestling/config`](../../packages/nestling.config/), [d/05 §11,§15](../history/discussions/05-modular-monolith-features-ports.md), ревизия владения [ideas.md [2026-07-10]](./ideas.md), форма секции — рекорд полей [ideas.md [2026-07-14]](./ideas.md) |
| 10 | `features` | `makeFeature`/`select`/`assemble`; `@OnStart`/go-live (гарантия `dispatch`: `serve(dispatch, signal)` вместо `listen()`); транспорты как провайдеры; capability = DI + fail-fast | L | **done** — [архив](../../openspec/changes/archive/2026-07-31-features/), [`@nestling/app`](../../packages/nestling.app/), [d/05 §2,§7–§10](../history/discussions/05-modular-monolith-features-ports.md) |
| 11 | `ports` | `makeContract` (request/command/event), `Port`/`Emitter`, `IMessageBus`, `InProcessBus`, dispatch-policy; local/remote-биндинг на сборке (co-located, L3) | L | **done** — [архив](../../openspec/changes/archive/2026-07-31-ports/), новый пакет [`@nestling/ports`](../../packages/nestling.ports/), [гайд](../guides/ports.md), [ideas.md [2026-07-31]](./ideas.md), [d/05 §3](../history/discussions/05-modular-monolith-features-ports.md) |
| 12 | `transport.nats` | NATS как inbound+outbound транспорт; queue-groups для реплик; remote-биндинг портов; JetStream для `durable` (split, L4) | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-transport-nats/), новый пакет [`@nestling/transport.nats`](../../packages/nestling.transport.nats/), пример [`examples.split-nats`](../../packages/examples.split-nats/), [ideas.md [2026-07-31] «NATS: шина приложения»](./ideas.md), [d/05 §3](../history/discussions/05-modular-monolith-features-ports.md) |
| 13 | `plugins` | cross-cutting: инфра = параметризованные модули (конвенция, нового примитива нет); `plugins:` в корне не будет — перечень полей `assemble` закрыт; идентичность модуля — значение, одноимённые разные значения — ошибка сборки; pipeline-слои + policy-check вместо ambient middleware; feature-scoped инфра едет с фичей | S | **done** — [архив](../../openspec/changes/archive/2026-07-31-plugins/), [d/05 §16](../history/discussions/05-modular-monolith-features-ports.md) |
| 14 | `multi-injection` | `Family.all` — синтетический узел-агрегат: массив всех зарегистрированных членов семейства на `build()` (multi-injection без `multi: true`; вклады — обычные провайдеры с членскими токенами) | S | **done** — [архив](../../openspec/changes/archive/2026-07-29-multi-injection/), [ideas.md [2026-07-10]](./ideas.md) |
| 15 | `error-model` | Fail — значение (возврат ≡ бросок; фикс `normalizeResponse`: возвращённый `Fail` сейчас уезжает как `200 OK`); `Output<T>` включает `Fail`, дискриминант `isFail`; словарь статусов (`CONFLICT`, `TIMEOUT`, `TOO_MANY_REQUESTS`) + `code`/`cause`; `defineFail` (code-идентичность вместо instanceof); `errors:` в контракте endpoint'а, типизированный канал (`Output<T, E>` + бросатель `meta.fail`); граница нормализует незадекларированное в `UnknownError` → закрытый контракт `E ∪ UnknownError` | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-error-model/), [ideas.md [2026-07-10]](./ideas.md) |
| 16 | `async-context` | `contextVar<T>()('key')` + писатель `Var.provide(…)` + инжектируемые ридеры `Ctx(Var)` (token family); read-only ALS-проекция накопленного `input` (+ `signal`), писатель ячейки — только рантайм пайплайна; `get()/peek()` (зеркало полный/Partial); opt-in policy-check присутствия — предикат `hasVar` на `build()`; `contextValue` в тестовом корне | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-async-context/), [ideas.md [2026-07-10]](./ideas.md); `propagate` через remote-порты — вместе с 12 |
| 17 | `pipeline-drop-after` | убрать `.after` из билдера/типов/рантайма (`ResponsePhase` = `'ok' \| 'catch'`); словарь ответного тракта — Promise-тройка `ok`/`catch`/`finally`; правка спеков и доков (`docs/preview`) | S, breaking | **done** — [архив](../../openspec/changes/archive/2026-07-29-pipeline-drop-after/), [ideas.md [2026-07-10]](./ideas.md) |
| 18 | `testing-package` | `@nestling/testing`: `assembleTest` (`overrides` только в тестовом корне; подстановка на ASSEMBLE + прунинг осиротевших поддеревьев; фазы 0–3 без START → in-proc `app.call`/`app.emit` по схемам; `await using` → SHUTDOWN), `vars()` (объектный `ConfigSource` c `watch`/`set`), `stub(Contract, impl)` (фейк-порт, валидируемый схемой контракта), `familyOverride`, `.check()` (фазы 0–1, матрица `select`-топологий в CI), `testModule()`; конвенция `./testing`-subpath (conditional export) | M | **done** — ядро: [архив](../../openspec/changes/archive/2026-07-31-testing-package/); остаток (`stub(Contract, impl)`, `app.emit`, `app.stubbed`): [архив](../../openspec/changes/archive/2026-08-01-testing-stub-contract/); пакет [`@nestling/testing`](../../packages/nestling.testing/), [ideas.md [2026-07-10]](./ideas.md) |
| 19 | `standard-schema` | ядро принимает `StandardSchemaV1` вместо `z.ZodType`: `parsePayload`/`DomainType` через `~standard.validate`/`InferOutput`; `SchemaValidationError` несёт стандартные `issues` вместо `ZodError`; zod → devDependency; Promise из `validate` = ошибка | S–M, breaking | **done** — [архив](../../openspec/changes/archive/2026-07-29-standard-schema/), [ideas.md [2026-07-13]](./ideas.md) |
| 20 | `openapi` | `@nestling/openapi`: генерация OpenAPI из деклараций endpoints; конвертеры `SchemaDocConverter` — явные, по `~standard.vendor`, отдельными пакетами (`@nestling/openapi.zod`, …); boot-time проверка конвертируемости всех схем; `jsonSchema`-override; `errors:` → responses; предпосылка — bind-карта (21) | M–L | **done** — [архив](../../openspec/changes/archive/2026-08-01-openapi/), новые пакеты [`@nestling/openapi`](../../packages/nestling.openapi/) и [`@nestling/openapi.zod`](../../packages/nestling.openapi.zod/), [гайд](../guides/openapi.md), [ideas.md [2026-07-13]](./ideas.md) |
| 21 | `input-bind` | канон размещения HTTP-input + bind-карта: детерминированное `(pattern, метод, пометки) → path/query/body`; сахар-пометки `query()` (заголовки — только по пометке, `header()` отложен в deferred.md) → плоская bind-карта — несущий уровень для транспорта/OpenAPI/клиента; разворачивание и fail-fast на создании декларации; strict-приём вместо merge (уходит `PayloadConflictError`); query-массивы (фикс last-wins); opt-in `rawBody: true` в HTTP-словаре — байты в типизированном стартовом контексте (webhook-подписи) | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-07-30-input-bind/), [ideas.md [2026-07-13]](./ideas.md) |
| 22 | `contract-clients` | `@nestling/contracts` (`makeContract` с `http:`-биндингом, `defineFail`; zero runtime deps — только Standard Schema types) + `@nestling/client`: `makeClient(record, { baseUrl, headers })` → API-объект, возврат `Ok\|Fail` (call-site ≡ порту); рематериализация `Fail` по `code`; валидация ответа по `output`-схеме (`~standard.validate`); streaming-клиент — v2 (после 6) | M → L | **done** — идея [ideas.md [2026-07-13]](./ideas.md), реализация [ideas.md [2026-08-01]](./ideas.md) |
| 23 | `pipeline-type-dx` | бюджет на DX типов pipeline: типы-ошибки в точке `compose` (читаемый литерал `__error` + `missing` вместо трассировки дженериков), snapshot-тесты текстов диагностик по фикстурам неправильных композиций, бенчмарк tsserver (~50 слоёв) с порогом в CI; попутно — сигнатура `compose` на прямой вывод тип-параметров (`TS2589` на 20 слоях уходит) | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-31-pipeline-type-dx/), [ideas.md [2026-07-13]](./ideas.md) |
| 24 | `endpoint-model` | уход классовых endpoint-деклараций: канон — декларации-значения через per-transport конструкторы (`httpEndpoint`/`cliEndpoint` — типизированный словарь: path-параметры, bind-карта из 21); `deps`-инжект + формы хендлера (функция / каррированная фабрика / класс-хендлер через контейнер); `endpoints:` модуля принимает значения; удаление `@Endpoint`/`@HttpEndpoint`/`IEndpoint`/endpoint-registry; standalone-гарантия в типах (`route` — только deps-free); перевод `examples.app-with-http` и гайдов; классы остаются DI-формой провайдеров/юнитов/хендлеров; онтология — контракт первичен: конструкторы = сахар «анонимный контракт + `implement`»; CLI-биндинг — политика сбора недостающего input из схемы (`missing: 'prompt'`) — **вне scope этого change'а** | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-07-30-endpoint-model/), [ideas.md [2026-07-13]](./ideas.md) |
| 25 | `config-secrets` | `secret(leaf)` в `makeConfig` (каноническая композиция `secret(from(...))`; редактирование в трёх поверхностях: текст **и объект** `ConfigValidationError`, display-хуки проекции `toJSON`/`inspect.custom`, снимок реестра; незаданный ключ не редактируется); семантика общих ключей: независимая валидация каждой секцией, fail-fast на несогласованном `reloadable` в границах сборки, секретность по объединению **объявленных** читателей, перечень читателей в `describeConfig()` | S | **done** — идея [ideas.md [2026-07-13]](./ideas.md), реализация [ideas.md [2026-08-01]](./ideas.md) |
| 26 | `contract-versioning` | версия явно в имени контракта; `describeContract` → дескриптор-значение (листья — через `SchemaDocConverter`, без конвертера честно непрозрачны); `snapshotContracts` сводит `.check()`-матрицу объединением топологий; `diffContracts` с закрытым словарём `breaking`/`additive`/`unknown` и направлением по слоту; отчёт-значение плюс `formatCompatibility` и подсказка bump'а — подсвечивает, не блокирует (флага блокировки не существует) | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-31-contract-versioning/), [гайд](../guides/ports.md), [ideas.md [2026-07-31]](./ideas.md), [ideas.md [2026-07-13]](./ideas.md) |
| 27 | `port-deadline-idempotency` | `meta.deadline` (gRPC-модель: абсолютный момент `Date` в процессе, относительный `timeoutMs` по проводу, пересчёт на приёме; fail-fast до вызова и до обработки, отмена в полёте; встроенный код `DEADLINE_EXCEEDED`, определение `DeadlineExceeded` — в `@nestling/pipeline`, где живёт закрытый набор); `idempotencyKey` в meta **только** у `command` (`MetaOf<C>` по виду; ключ чеканит вызыватель, если не дан; провоз конвертом шины; дедупликация — satellite, не ядро); профиль двумя каналами — `raw.attributes` и переменные `Deadline`/`IdempotencyKey` | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-port-deadline-idempotency/), [гайд](../guides/ports.md), [ideas.md [2026-07-31]](./ideas.md), [ideas.md [2026-07-13]](./ideas.md) |
| 28 | `policy-check` | инварианты на собранном графе: `assemble({ policies })`, `everyEndpoint(фильтр).hasLayer(ref)` (идентичность слоя — по ссылке); `detached: '<причина>'` (строка обязательна) + печать detached-ручек на старте; ESLint-правило как editor-фидбек; машинерия для 13 (plugins) и 16 (async-context), прогон в `.check()`-матрице (18) | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-31-policy-check/), новый пакет [`@nestling/eslint-plugin`](../../packages/nestling.eslint-plugin/), [ideas.md [2026-07-14]](./ideas.md) |
| 29 | `input-validation-builtin` | проверка входа по `input` — обязанность рантайма: одна точка после всех `.pre`-юнитов и перед хендлером, кандидат — `payload` из контекста или `raw.payload`, отказ от проверки объявляется схемой `z.unknown()`; **BREAKING** — юнит `validate()` удалён, ветка «без пайплайна» в `dispatch` заменена пустым пайплайном (один путь исполнения), копия проверки `multipart` убрана из HTTP-транспорта; новый kernel-код `PAYLOAD_TOO_LARGE` доводит 413 лимита потокового входа до клиента на обоих видах деклараций | M | **done** — [архив](../../openspec/changes/archive/2026-09-01-input-validation-builtin/), идея [ideas.md [2026-08-29]](./ideas.md), реализация [ideas.md [2026-09-01]](./ideas.md) |
| 30 | `remove-module-exports` | удаление `Module.exports` и опции `strictExports`: модуль остаётся меткой принадлежности и единицей упаковки, границу держат ES-модули и границы пакетов; `metadata.exported` уходит из узла графа, вклад в семейство объявляется одним провайдером в `providers` | S, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-01-remove-module-exports/), [ideas.md [2026-09-01]](./ideas.md) |
| 31 | `composition-model` | три роли слоя приложения: модуль (метка принадлежности, `dependsOn` вместо `imports`, без `endpoints`), фича (`makeFeature`, без `dependsOn`) и плагин (`makePlugin`, поле корня `plugins:`); граница фичи проверяется обходом собранного графа; токен становится объектом с идентичностью по ссылке, члены семейств хранят принадлежность полями; `select: { features, includeDeps }`; `intercom:` назначает роль переносчика операций ссылкой на объявленный транспорт; транспорты — именованные экземпляры с `on:` в декларации; `makeContract({ kind })` заменён на `makeRequest`/`makeCommand`/`makeEvent`, `.port` → `.caller` | L, breaking | **done** — [ideas.md [2026-09-02]](./ideas.md) |

## Порядок и зависимости

```
базовая ветка (pipeline/streaming):
  1 transport-hardening ─┐
  2 container-fixes ─────┼─ независимы, можно сразу
  3 abort-signal ────────┴─→ 6 streaming-v2 ─→ 7 subscriptions-registry
  4 pipeline-v2 ────────────↗
  5 token-families — после 4 (или параллельно)
  14 multi-injection (Family.all) — после 5, аддитивно
  15 error-model — после 4 (normalizeResponse, Output); нужен 11 ports (ре-гидрация Fail)
  16 async-context — после 4 и 5 (Ctx — token family); propagate нужен 12 transport.nats
  17 pipeline-drop-after — после 4, до фиксации публичного API V1 (пока .after никто не использует)
  19 standard-schema — после 4, до фиксации публичного API V1 (breaking: SchemaValidationError)
  21 input-bind — после 4 (декларации); несущий уровень для 20 и 22
  20 openapi — после 19, 8 (дискавери) и 21 (bind-карта); errors: → responses требует 15
  22 contract-clients — после 11 (makeContract), 15 (defineFail/errors:), 19 и 21
  23 pipeline-type-dx — после 4, до фиксации публичного API V1
  24 endpoint-model — после 4, рядом с 8 (реестр умирает вместе с @Endpoint); до фиксации публичного API V1

ветка «модульный монолит» (сессия 2026-07-08):
  8 endpoint-discovery ─┐
                        ├─→ 10 features ─→ 11 ports ─→ 12 transport.nats
  5 token-families ─→ 9 config-module ─┘        │
  4 pipeline-v2 ────────────────────────────────┼─→ 13 plugins
  6 streaming-v2 (Topic) ── переиспользуется 11 (InProcessBus) и 9 (reloadable)
  18 testing-package — ядро после 9+10 (assemble, фазы, vars); stub(Contract) — после 11
  25 config-secrets — после 9 (makeConfig, describeConfig(), реестр ключей)
  26 contract-versioning — после 11 (makeContract); отчёт живёт в .check()-матрице (18)
  27 port-deadline-idempotency — после 11 (dispatch); wire-часть — вместе с 12
  28 policy-check — после 4 (слои-значения) и 8 (полный граф endpoints); используется 13 и 16
```

Базовая ветка:

- 1 и 2 — быстрые исправления, не зависят от целевого дизайна.
- 3 — маленькая предпосылка для 6 (и полезна сама по себе: чинит вечный
  `close()` на живых соединениях).
- 4 — самый большой и ломающий; см. миграционную сложность в ideas.md.
- 6 требует 3 (signal) и 4 (item-цепочки описаны в терминах новой модели);
  io-формы и capability-валидация биндинга — [ideas.md [2026-07-13]](./ideas.md)
  «Контракт первичен» (формы = вход для media types в 20 и fail-fast
  порта/шины в 11).
- **7 `subscriptions-registry`** — **сделан**, последним по плану: тест того, что
  публичных примитивов достаточно. Результат: пакет собран целиком поверх них,
  `git diff` по kernel-пакетам за весь change пуст, внешних зависимостей нет.
  Четыре находки (зарезервированный `signal`, `Outcome` без `killed`, кластерное
  управление, `.finally` у непрочитанного потока) закрыты записями журнала, а не
  правками ядра — [ideas.md [2026-08-01]](./ideas.md).
- **15 `error-model`** — можно сразу после 4; ре-гидрация remote-`Fail` —
  вклад в 11 (`ports`), но не блокирует ядро change'а.
- **16 `async-context`** — после 5 (ридеры `Ctx(Var)` — члены семейства);
  `propagate` реализуется вместе с 12 (`transport.nats`); policy-check
  присутствия — та же машинерия, что startup policy-check в 13 (`plugins`).
- **19 `standard-schema`** — после 4; желательно до фиксации публичного API V1, пока
  на `SchemaValidationError.zodError` никто не опёрся (breaking сменой формата
  на стандартные `issues`).
- **20 `openapi`** — после 19 (конвертеры), 8 (дискавери endpoints из дерева)
  и 21 (bind-карта разрешает бывший дизайн-блокер «разложение merged payload»);
  `errors:` → responses приезжает из 15.
- **21 `input-bind`** — после 4 (декларации endpoints); breaking для приёма
  «поле отовсюду». Несущий уровень для 20 (`parameter` vs `requestBody`)
  и 22 (сборка запроса клиентом). Логика — [ideas.md [2026-07-13]](./ideas.md)
  «Канонизация HTTP-input», согласовано в
  [d/06 П.4](../history/discussions/06-critical-design-review.md).
  `rawBody` — пометка словаря, меняющая **тип** стартового контекста
  декларации: слой проверки подписи объявляет `{ rawBody }` требованием,
  забытая пометка = ошибка в точке композиции («Контракт первичен», п. 6).
- **22 `contract-clients`** — **сделан**. После 11 (`makeContract`), 15
  (`defineFail`, `errors:`), 19 (`~standard.validate` на клиенте) и 21
  (bind-карта). Упаковка учтена буквально: декларативный слой **переехал** в
  zero-deps `@nestling/contracts`, а `@nestling/ports` `makeContract` не
  реэкспортирует. Streaming-клиент — v2, после 6. Логика —
  [ideas.md [2026-07-13]](./ideas.md) «Типизированные клиенты из контрактов»
  и [ideas.md [2026-08-01]](./ideas.md) «Клиенты из контрактов: реализация»,
  дискуссия — [d/07](../history/discussions/07-typed-clients.md).
- **23 `pipeline-type-dx`** — после 4, **до фиксации публичного API V1**: типы-ошибки
  и пороги дешевле вводить до фиксации публичного API; после релиза упрощение
  типов — breaking. Логика — [ideas.md [2026-07-13]](./ideas.md)
  «Бюджет на DX типов pipeline».
- **24 `endpoint-model`** — после 4; логично ехать в том же breaking-окне, что
  17/19 (до фиксации публичного API V1); делать рядом с 8 (глобальный реестр умирает
  вместе с `@Endpoint`). Согласован с 21 (bind-карта разворачивается в
  конструкторе декларации) и 22 (`httpEndpoint` — инлайн-форма контракта);
  желательно до 15 (типизированный канал `E` проектируется под единственную
  форму декларации) и до 20 (OpenAPI потребляет транспортный словарь
  деклараций). «Транспорт токеном» — вместе с 10 (транспорты-провайдеры).
  `@Injectable`-провайдеры и юниты-классы не затронуты; класс-хендлер остаётся
  DI-формой поля `handle`. Онтология — контракт первичен: конструкторы =
  сахар «анонимный контракт + `implement`», мультитранспорт именованного
  контракта — биндинги в контракте + один `implement`. Логика —
  [ideas.md [2026-07-13]](./ideas.md) «Один канонический стиль деклараций» +
  «Endpoint-декларации» + «Контракт первичен», дискуссия —
  [d/08](../history/discussions/08-endpoint-declarations-and-styles.md)
  (с продолжением).

Ветка «модульный монолит»:

- **8 `endpoint-discovery`** — независим, S; предпосылка для 10 и баг-фикс сам по
  себе. Делаем первым.
- **9 `config-module`** — поверх 5 (token-families) — **done**,
  [архив](../../openspec/changes/archive/2026-07-31-config-module/). Точка
  привязки временно живёт в `AppConfig.config`; переезд в `assemble()` — одна
  строка в 10.
- **10 `features`** — после 8 (дискавери) и 9 (конфиг в `assemble`); включает
  `@OnStart`/go-live и транспорты-провайдеры.
- **11 `ports`** — после 10 (биндинг по топологии/`select`) и 4 (endpoints);
  `InProcessBus` переиспользует `Topic` из 6. Порт на контракт с формами
  `stream`/`events` — fail-fast на ASSEMBLE (v1: только value-формы;
  стриминг по шине — v2).
- **12 `transport.nats`** — после 11 (remote-биндинг, queue-groups, JetStream).
- **13 `plugins`** — после 10 (feature-scoped инфра) и 4 (pipeline-слои);
  startup policy-check — из отложенного в pipeline-v2.
- **18 `testing-package`** — ядро (`assembleTest`, `.check()`, `vars()`,
  `familyOverride`, `checkTopologies`, `testModule`, `unwrap`) **сделано**
  после 9 и 10 (нужны `assemble`, фазовый lifecycle, источники);
  `stub(Contract)` — после 11. Вместе с ним в остаток уехал **`app.emit`**:
  понятия `Event` (контракт вида `event`, `Emitter`, шина) в ядре нет, и
  эмитить нечего; форма `app.call` выбрана так, чтобы `emit` встал рядом без
  переделки. Это единственный пункт исходного скоупа, который перенесён.
  Остаток **сделан** в волне 6 — change `testing-stub-contract`,
  [архив](../../openspec/changes/archive/2026-08-01-testing-stub-contract/) —
  и подтвердил
  расчёт: заготовленное поле `stubs:` приняло контрактные стабы без правок, а
  ядра портов, контрактов, контейнера и `App` не потребовалось трогать ни
  строкой. Сверх записи приехал `app.stubbed` — состав подстановок значением
  для сверки с матрицей `.check()`.
- **25 `config-secrets`** — **сделан**. Аддитивно поверх 9; в спеку 9 не
  вносится (9 spec-ready, расширять скоуп задним числом не хотим). Реализация
  уточнила две вещи, которых запись не называла: редактируется **объект**
  ошибки, а не только её текст (`failures` — публичное поле), и области
  считаются по-разному — секретность по **объявленным** секциям, конфликт
  `reloadable` по **материализованным** (редактирование ошибается в
  безопасную сторону, запрет — в опасную). Обещанные «читатели ключа в
  `explain()`» приземлились в `describeConfig()`: графового `explain()` в
  коде нет. Логика — [ideas.md [2026-07-13]](./ideas.md) «Конфиг: `secret()`
  и общие ключи» + блок реализации [2026-08-01].
- **26 `contract-versioning`** — после 11; отчёт совместимости — расширение
  `.check()`-матрицы (18). Открытым остаётся, где живёт снапшот схем
  (репо vs registry): форма API выбрана так, что ответ не меняет ни одной
  сигнатуры — baseline приходит значением. Логика —
  [ideas.md [2026-07-13]](./ideas.md) «Порты: deadline, идемпотентность,
  версионирование контрактов» и, по факту реализованного,
  [ideas.md [2026-07-31]](./ideas.md) «Версионирование контрактов: снапшот
  из дискавери, вердикт по слоту, третий вердикт `unknown`».
- **27 `port-deadline-idempotency`** — после 11 (dispatch, meta); провоз по
  сети (кодирование конверта в NATS headers) — вместе с 12. Дедупликация —
  satellite, вне скоупа. Автонаследование бюджета вглубь отвергнуто и
  отложено ([deferred.md [2026-07-31]](./deferred.md)). Логика —
  [ideas.md [2026-07-13]](./ideas.md) и, по факту реализованного,
  [ideas.md [2026-07-31]](./ideas.md).
- Рекомендуемый вход в ветку: **8 → 9 → 10 → 11 → 12**, `13` — параллельно после 10.

## Волны реализации

Граф выше говорит, что **можно** делать после чего. Волны говорят, что
**стоит** делать раньше, по одному критерию: *сначала то, что удешевляет всё
последующее*. Отсюда два неочевидных сдвига против порядка зависимостей —
breaking-окно едет вторым (а не после ветки монолита), а ядро
`testing-package` (18) — раньше, чем позволяет буква графа.

Порядок внутри волны рекомендованный; параллелить стоит только явно
независимые пары, каждую — в своём git worktree.

### Волна 0 — рабочий контур

Не change'и и не про целевой дизайн: инструментальная база, без которой
позадачная работа буксует.

| Пункт | Почему |
|---|---|
| Вернуть openspec CLI (`@fission-ai/openspec`, ~1.6) | сейчас его нет на PATH — `/opsx:propose\|apply\|archive` падают на первом же вызове |
| Root-скрипт `verify` = `nx run-many -t build lint test` | в корневом `package.json` нет ни одного скрипта, а DoD нужна одна gate-команда. Baseline 2026-07-28 — зелёный, 15 проектов |
| DoD в `rules.tasks` (`openspec/config.yaml`) + в `CLAUDE.md` | DoD доезжает до каждой сессии сам, а не повторяется руками в промпте. `rules` в openspec keyed по **artifact ID** (`proposal`/`design`/`specs`/`tasks`), ключа `apply` не существует — поэтому правило заставляет `propose` класть DoD последним разделом `tasks.md`, а `CLAUDE.md` держит тот же список для change'ей, чьи `tasks.md` сгенерированы раньше |
| Auto-режим на время apply-сессии | сессия не встаёт на подтверждениях и доезжает до конца без присмотра |
| Ветка на change (`change/<имя>`) | поверхность ревью = `git diff main...` |

### Волна 1 — фундамент контейнера (аддитивно)

| # | Change | Размер | Почему здесь |
|---|---|---|---|
| 5 | `token-families` | M | разблокирует 9, 14, 16 — **done**, [архив](../../openspec/changes/archive/2026-07-29-token-families/) |
| 14 | `multi-injection` | S | тот же файл-фронт в контейнере, что и 5 — дешевле сразу следом — **done**, [архив](../../openspec/changes/archive/2026-07-29-multi-injection/) |

Выход: контейнер умеет параметризованные провайдеры и агрегаты семейств;
публичное API не сломано ни в одной точке.

### Волна 2 — breaking-окно: фиксация публичного API V1

Состав окна закрыт записью [ideas.md [2026-07-14]](./ideas.md) «Kernel 1.0»
(п. 3). Ставим сразу после волны 1, потому что цена окна растёт с объёмом
кода: сегодня переписать нужно только `examples.app-with-http` (~1.8k строк
на классовых `@Endpoint` и zod), после волн 3–5 — всё, что поверх них
построено.

| # | Change | Размер | Почему в этом месте |
|---|---|---|---|
| 19 | `standard-schema` | S–M | самый нижний слой (валидация): чем раньше, тем меньше кода написано против `z.ZodType` — **done**, [архив](../../openspec/changes/archive/2026-07-29-standard-schema/) |
| 17 | `pipeline-drop-after` | S | чистое удаление фазы; после появления новых слоёв дорожает — **done**, [архив](../../openspec/changes/archive/2026-07-29-pipeline-drop-after/) |
| 8 + 24 | `endpoint-discovery` + `endpoint-model` | S + M | одним заходом: глобальный реестр умирает вместе с `@Endpoint` — 8 **done**, [архив](../../openspec/changes/archive/2026-07-29-endpoint-discovery/); 24 **done**, [архив](../../openspec/changes/archive/2026-07-30-endpoint-model/) |
| 21 | `input-bind` | M | поверх новых деклараций; несущий уровень для 20 и 22 — **done**, [архив](../../openspec/changes/archive/2026-07-30-input-bind/) |
| 23 | `pipeline-type-dx` | S–M | закрывает окно: снапшоты диагностик и порог tsserver снимаются с уже зафиксированных типов — **done**, [архив](../../openspec/changes/archive/2026-07-31-pipeline-type-dx/) |

Выход: **публичный API V1 зафиксирован**, дальше всё аддитивно.

**Breaking-окно закрыто** (2026-07-31): весь состав волны реализован.
Поверхность вызова `compose` при этом не менялась — переписана внутренняя
форма типизации; наблюдаемо сломались только поля типов-ошибок
(`ERROR`/`MISSING_FIELDS`/…, на них ссылались лишь type-тесты репозитория).
Дальнейшие изменения публичного API V1 — аддитивные.

### Волна 3 — семантика ядра

| # | Change | Размер | Почему здесь |
|---|---|---|---|
| 15 | `error-model` | M | баг-фикс поставлен: возвращённый `Fail` больше не уезжает как `200 OK` — **done**, [архив](../../openspec/changes/archive/2026-07-31-error-model/) |
| 6 | `streaming-v2` | L | `Topic` отсюда переиспользуют 9 (reloadable) и 11 (InProcessBus) — значит, до волны 4 — **done**, [архив](../../openspec/changes/archive/2026-07-31-streaming-v2/) |

**Волна 3 закрыта** (2026-07-31): оба change'а реализованы и заархивированы.
Волна 4 получает готовыми обе предпосылки, ради которых порядок и был такой:
закрытый контракт отказов (`errors:` + страж границы) и `Topic` из нового
пакета `@nestling/streams` — его переиспользуют `reloadable` конфига (#9) и
`InProcessBus` портов (#11).

### Волна 4 — композиция и модульный монолит

| # | Change | Размер | Почему здесь |
|---|---|---|---|
| 9 | `config-module` | M–L | **done** — [архив](../../openspec/changes/archive/2026-07-31-config-module/); поверх 5 и `Topic` из 6 |
| 10 | `features` | L | **done** — [архив](../../openspec/changes/archive/2026-07-31-features/); `assemble`, фазовый lifecycle, `@OnStart`/go-live, транспорты-провайдеры |
| 18 | `testing-package` (ядро) | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-testing-package/); поставлен **раньше, чем требует граф**: `assembleTest`/`vars()`/`.check()` удешевляют каждый следующий change; `stub(Contract)` и `app.emit` — [остаток в волне 6](#волна-6--экосистема-и-выход) |
| 28 | `policy-check` | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-31-policy-check/); нужен был полный граф — после 8 (дискавери) и 10 (assemble) |
| 13 | `plugins` | S | **done** — [архив](../../openspec/changes/archive/2026-07-31-plugins/); поверх 10 и машинерии 28 |
| 16 | `async-context` | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-async-context/); ридеры `Ctx(Var)` — семейство из 5, предикат `hasVar` — машинерия 28 |

**Волна 4 закрыта** (2026-07-31): все шесть change'ей реализованы и
заархивированы. Composition root зафиксирован (`assemble` с закрытым перечнем
полей), инварианты проверяются на собранном графе, ambient-контекст закрыл
последнюю дыру «глубокому коду нужен `requestId`» без нового примитива.
Волна 5 получает готовыми `Topic` (#6), фазовый lifecycle с go-live (#10),
тестовый корень (#18) и словарь политик (#28) — всё, на что опираются порты.

**Оговорка о BREAKING в аддитивной волне.** Волна 4 объявлена аддитивной,
но change #10 ломает три публичные поверхности сразу: исчезает конструктор
`new App({ transports: Record })` (корень — только `assemble`), исчезает
нульарный `listen()` вместе с точками регистрации ручки на транспорте
(go-live — только `serve(dispatch, signal)`), и поле `transport` декларации
несёт токен вместо строки (`Raw.transport`/`EndpointMeta.transport`
остаются строками — имя выводится из id токена, слои не ломаются). Все три
предписаны целевым design'ом и приезжают одним change'ом, а не
размазываются по волне: после #10 публичный корень зафиксирован.

### Волна 5 — порты и распределённость

| # | Change | Размер | Почему здесь |
|---|---|---|---|
| 11 | `ports` | L | **done** — [архив](../../openspec/changes/archive/2026-07-31-ports/); `makeContract`, `Port`/`Emitter`, `InProcessBus`, dispatch-политики |
| 27 | `port-deadline-idempotency` | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-port-deadline-idempotency/); `meta.deadline` моментом, `idempotencyKey` у команд, конверт шины |
| 26 | `contract-versioning` | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-31-contract-versioning/); снапшот из дискавери, дифф с тремя вердиктами, отчёт в `.check()`-матрице (18) |
| 12 | `transport.nats` | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-transport-nats/); remote-биндинг, queue-groups, JetStream, wire-часть `propagate` из 16; пакет `@nestling/transport.nats` и пример `examples.split-nats` |
| 22 | `contract-clients` | M → **L** | **done** — [архив](../../openspec/changes/archive/2026-08-01-contract-clients/); `@nestling/contracts` (переезд декларативного слоя, секция `http:`, контракт-форма `httpEndpoint`) + `@nestling/client`; оценка M не сошлась: цена не в новой логике, а в физическом переезде слоя между пакетами |

**Волна 5 закрыта** (2026-08-01): все пять change'ей реализованы и
заархивированы. Межфичевое общение выражено контрактом, а не вызовом соседа;
биндинг «local или remote» выбирается на сборке, и `examples.split-nats`
держит один код фич при двух корнях — тезис L4 проверен кодом, а не
обещанием. Контракт стал двусторонним значением: та же декларация адресует
шину именем и HTTP-провод секцией `http:`, и внешний клиент читает её из
zero-deps пакета.

Волна 6 получает готовыми обе предпосылки, которых ей не хватало: bind-карту
на контракте и в декларации (#21 плюс #22) — несущий уровень для генератора
OpenAPI (#20), и порты (#11) — для `stub(Contract)` (#18, остаток) и реестра
подписок (#7).

### Волна 6 — экосистема и выход

| # | Change | Размер | Почему здесь |
|---|---|---|---|
| 20 | `openapi` | M–L | все предпосылки закрыты: 19 (конвертеры), 8, 21 (bind-карта), 15 (`errors:`) |
| 25 | `config-secrets` | S | **done** — [архив](../../openspec/changes/archive/2026-08-01-config-secrets/); `secret(from(...))`, три поверхности редактирования, общий ключ и конфликт `reloadable` в границах сборки; ядро не тронуто нигде, кроме `@nestling/config` |
| 18 | `stub(Contract)` + `app.emit` (остаток) | S | **done** — [архив](../../openspec/changes/archive/2026-08-01-testing-stub-contract/); фейк-вызыватель, валидируемый схемами контракта, `app.emit` как драйвер снаружи и `app.stubbed` для сверки с матрицей; ядро не тронуто нигде |
| 7 | `subscriptions-registry` | M | **done** — финальная проверка тезиса состоялась: satellite написан, ядро не тронуто, четыре находки — в журнале |

**Волна 6 закрыта** (2026-08-01), а с ней и план до целевого состояния V1.
Последний change был не про новую способность, а про **проверку**: реестр
подписок — тот самый satellite, на котором проверялся тезис «всё, что требует
стораджа или внешних систем, пишется поверх публичных примитивов, не трогая
ядро» ([ideas.md [2026-07-14]](./ideas.md) «Kernel 1.0», п. 1). Тезис
подтвердился буквально: пять workspace-зависимостей, ноль внешних, ноль
`@nestling/app`, пустой `git diff` по kernel-пакетам. Границы, в которые
пакет упёрся, зафиксированы отчётом, а не заклеены: три известные находки
подтвердились кодом, четвёртая (`.finally` не выполняется у потокового
ответа, закрытого до первого элемента) найдена по ходу и осталась дефектом
ядра под отдельный change — правка ядра здесь обесценила бы сам замер.

### После волны 6

План до целевого состояния V1 закрыт волнами 0–6. Дальнейшие change'и
заводятся по мере находок и в волны не входят.

| # | Change | Размер | Почему |
|---|---|---|---|
| 29 | `input-validation-builtin` | M | **done** — гарантия «хендлер получает проверенный вход» держалась на дисциплине «не забудь `validate()`»; вместе с ней сведены в один два пути исполнения endpoint'а |
| 30 | `remove-module-exports` | S | **done** — [архив](../../openspec/changes/archive/2026-09-01-remove-module-exports/); модуль остаётся меткой принадлежности, границу держат ES-модули |
| 31 | `composition-model` | L | **done** — фича, плагин и операция как три роли с разными правилами; граница фичи проверяется на собранном графе, токен стал объектом, `intercom:` назначает роль ссылкой на транспорт |

Change'и ломающие, хотя окно фиксации публичного API закрыто волной 2. Это
осознанно: они правят гарантии, а не добавляют способности, и цена
исправления росла бы с каждым написанным поверх приложением.

### Порядок величины

Грубо: S ≈ одна сессия `apply`, S–M ≈ 1–2, M ≈ 2–3, M–L ≈ 3–4, L ≈ 4–6;
плюс ~0.5 сессии на `propose`.

| Волна | Change'ей | Сессий, порядок величины |
|---|---|---|
| 1 — фундамент контейнера | 2 | ~4 |
| 2 — breaking-окно | 6 | ~12 |
| 3 — семантика ядра | 2 | ~9 |
| 4 — композиция | 6 | ~18 |
| 5 — распределённость | 5 | ~16 |
| 6 — экосистема | 4 | ~9 |

Первые две волны (~16 сессий) дают зафиксированный публичный API — точку,
после которой ничего из написанного не переписывается.

## Как работать

Единица работы — **один change = одна ветка**. Цикл из трёх шагов, каждый в
**свежем контексте**:

| Шаг | Команда | Что ревьюим |
|---|---|---|
| 1. Предложить | `/opsx:propose "<имя>: <scope + non-goals>"` | `proposal.md` (Why / What / Non-goals) и решения `design.md` — 300–700 строк markdown. Самое дешёвое место поймать ошибку дизайна |
| 2. Реализовать | `/opsx:apply <имя>` | `git diff main...` + дельта-спеки. Тесты — доказательство |
| 3. Закрыть | `/opsx:archive <имя>` | статус в таблице выше + абзац в [archlog.md](./archlog.md) |

Контекст между шагами передаётся **файлами в `openspec/changes/<имя>/`**, а не
разговором: `tasks.md` с чекбоксами — точка возобновления, если сессия
прервалась. Поэтому propose и apply намеренно разводятся по разным сессиям:
propose — это диалог с перебором вариантов, и apply, унаследовав его, будет
реализовывать *обсуждённое*, а не *записанное*.

Definition of Done одного change — в [`CLAUDE.md`](../../CLAUDE.md) («Workflow
изменений»), плюс `rules.tasks` в `openspec/config.yaml` заставляет `propose`
класть тот же список последним разделом `tasks.md`. Коротко: задачи отмечены,
`yarn verify` и `yarn docs:audit` зелёные, README пакетов и плашки обновлены,
`design/`+`decisions/` синхронизированы, примеры мигрированы и гайды
пересверены, ветка запушена.
