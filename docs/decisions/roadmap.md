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

| # | Change | Суть | Размер | Статус |
|---|---|---|---|---|
| 1 | `transport-hardening` | утечка stack trace в 500-ответах, лимит body, таймауты, 400 вместо 500 для ошибок входа, дренаж `close()` | S | **done** — [архив](../../openspec/changes/archive/2026-07-07-transport-hardening/) |
| 2 | `container-fixes` | module-метаданные функциональных провайдеров, накопление lifecycle-метаданных per-instance, JSDoc `get()` | S | **done** — [архив](../../openspec/changes/archive/2026-07-07-container-fixes/) |
| 3 | `abort-signal` | `meta.signal` (AbortSignal) насквозь: транспорт (дисконнект) + App (shutdown) | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-07-abort-signal/) |
| 4 | `pipeline-v2` | фазы `.pre/.ok/.catch/.after/.finally`, `makePipeline`, слои + `compose`, `TNeeds`, рантайм-тесты ядра | L, breaking | **done** — [архив](../../openspec/changes/archive/2026-07-13-pipeline-v2/) |
| 5 | `token-families` | `makeTokenFamily`, `.auto`, `familyProvider`; опционально `strictExports`. **Покрывает и конфиг (`Config(key)`), и on-demand-клиенты (`GrpcClient(server)` + unbound properties)** — см. [discussions/05 §15](../history/discussions/05-modular-monolith-features-ports.md#15) | M | **proposed** — [артефакты](../../openspec/changes/token-families/), готов к apply |
| 6 | `streaming-v2` | `stream` ≠ `events`, item-цепочки на io-декларации, `Topic`, `summary`, SSE; io-декларация как дерево форм (`value`/`stream`/`events`/`multipart` + `upload()`, листья — Standard Schema), поэлементная валидация; capability-валидация биндинга: формы контракта vs способности транспорта, fail-fast на ASSEMBLE | L | не начат |
| 7 | `subscriptions-registry` | пакет реестра подписок поверх signal + finish-хуков (dogfooding публичных примитивов) | M | не начат |
| 8 | `endpoint-discovery` | эндпоинты и транспорты — дискавери из дерева зарегистрированных модулей вместо глобального registry (чинит протечку глобального `Set` при любом импорте). Предпосылка фич | S | **spec-ready** — [d/05 §1](../history/discussions/05-modular-monolith-features-ports.md) |
| 9 | `config-module` | `makeConfig('prefix', schema)` + `from`; источники = объекты `ConfigSource` в одной приватной читалке (env — база, координаты из примордиального env); приватность = keys-capability (токен секции не экспортируется, наружу — branded-хэндл `.keys`; без `configs:`-регистрации и build()-проверки владения); привязка в корне плоским списком `config: [[src, keys \| glob]]`; reloadable (`Topic`/`AbortSignal`, живой хэндл); on-demand/unbound + доки из реестра (тег фичи из графа + флаг). Поверх `token-families` (5) | M–L | **spec-ready** — [d/05 §11,§15](../history/discussions/05-modular-monolith-features-ports.md) + ревизия владения [ideas.md [2026-07-10]](./ideas.md) + форма секции — рекорд полей [ideas.md [2026-07-14]](./ideas.md) |
| 10 | `features` | `makeFeature`/`select`/`assemble`; `@OnStart`/go-live (гарантия `dispatch`: `serve(dispatch, signal)` вместо `listen()`); транспорты как провайдеры; capability = DI + fail-fast | L | design — [d/05 §2,§7–§10](../history/discussions/05-modular-monolith-features-ports.md) |
| 11 | `ports` | `makeContract` (request/command/event), `Port`/`Emitter`, `IMessageBus`, `InProcessBus`, dispatch-policy; local/remote-биндинг на сборке (co-located, L3) | L | design — [d/05 §3](../history/discussions/05-modular-monolith-features-ports.md) |
| 12 | `transport.nats` | NATS как inbound+outbound транспорт; queue-groups для реплик; remote-биндинг портов; JetStream для `durable` (split, L4) | M | design — [d/05 §3](../history/discussions/05-modular-monolith-features-ports.md) |
| 13 | `plugins` | cross-cutting: инфра = параметризованные модули (конвенция, нового примитива нет); pipeline-слои + startup policy-check вместо ambient middleware; feature-scoped инфра едет с фичей | S | design — [d/05 §16](../history/discussions/05-modular-monolith-features-ports.md) |
| 14 | `multi-injection` | `Family.all` — синтетический узел-агрегат: массив всех зарегистрированных членов семейства на `build()` (multi-injection без `multi: true`; вклады — обычные провайдеры с членскими токенами) | S | идея — [ideas.md [2026-07-10]](./ideas.md) |
| 15 | `error-model` | Fail — значение (возврат ≡ бросок; фикс `normalizeResponse`: возвращённый `Fail` сейчас уезжает как `200 OK`); `Output<T>` включает `Fail`, дискриминант `isFail`; словарь статусов (`CONFLICT`, `TIMEOUT`, `TOO_MANY_REQUESTS`) + `code`/`cause`; `defineFail` (code-идентичность вместо instanceof); `errors:` в контракте endpoint'а, типизированный канал (`Output<T, E>` + бросатель `meta.fail`); граница нормализует незадекларированное в `UnknownError` → закрытый контракт `E ∪ UnknownError` | M | идея — [ideas.md [2026-07-10]](./ideas.md) |
| 16 | `async-context` | `contextVar<T>` + инжектируемые ридеры `Ctx(Var)` (token family); read-only ALS-проекция накопленного `input` (+ `signal`), писатель — только рантайм пайплайна; `get()/peek()` (зеркало полный/Partial); `propagate` через remote-порты; opt-in policy-check присутствия на `build()` | M | идея — [ideas.md [2026-07-10]](./ideas.md) |
| 17 | `pipeline-drop-after` | убрать `.after` из билдера/типов/рантайма (`ResponsePhase` = `'ok' \| 'catch'`); словарь ответного тракта — Promise-тройка `ok`/`catch`/`finally`; правка спеков и доков (`docs/preview`) | S, breaking | идея — [ideas.md [2026-07-10]](./ideas.md) |
| 18 | `testing-package` | `@nestling/testing`: `assembleTest` (`overrides` только в тестовом корне; подстановка на ASSEMBLE + прунинг осиротевших поддеревьев; фазы 0–3 без START → in-proc `app.call`/`app.emit` по схемам; `await using` → SHUTDOWN), `vars()` (объектный `ConfigSource` c `watch`/`set`), `stub(Contract, impl)` (фейк-порт, валидируемый схемой контракта), `familyOverride`, `.check()` (фазы 0–1, матрица `select`-топологий в CI), `testModule()`; конвенция `./testing`-subpath (conditional export) | M | идея — [ideas.md [2026-07-10]](./ideas.md) |
| 19 | `standard-schema` | ядро принимает `StandardSchemaV1` вместо `z.ZodType`: `parsePayload`/`DomainType` через `~standard.validate`/`InferOutput`; `SchemaValidationError` несёт стандартные `issues` вместо `ZodError`; zod → devDependency; Promise из `validate` = ошибка | S–M, breaking | идея — [ideas.md [2026-07-13]](./ideas.md) |
| 20 | `openapi` | `@nestling/openapi`: генерация OpenAPI из деклараций endpoints; конвертеры `SchemaDocConverter` — явные, по `~standard.vendor`, отдельными пакетами (`@nestling/openapi.zod`, …); boot-time проверка конвертируемости всех схем; `jsonSchema`-override; `errors:` → responses; предпосылка — bind-карта (21) | M–L | идея — [ideas.md [2026-07-13]](./ideas.md) |
| 21 | `input-bind` | канон размещения HTTP-input + bind-карта: детерминированное `(pattern, метод, пометки) → path/query/body`; сахар-пометки `query()` (заголовки — только по пометке, `header()` отложен в deferred.md) → плоская bind-карта — несущий уровень для транспорта/OpenAPI/клиента; разворачивание и fail-fast на создании декларации; strict-приём вместо merge (уходит `PayloadConflictError`); query-массивы (фикс last-wins); opt-in `rawBody: true` в HTTP-словаре — байты в типизированном стартовом контексте (webhook-подписи) | M, breaking | идея — [ideas.md [2026-07-13]](./ideas.md) |
| 22 | `contract-clients` | `@nestling/contracts` (`makeContract` с `http:`-биндингом, `defineFail`; zero runtime deps — только Standard Schema types) + `@nestling/client`: `makeClient(record, { baseUrl, headers })` → API-объект, возврат `Ok\|Fail` (call-site ≡ порту); рематериализация `Fail` по `code`; валидация ответа по `output`-схеме (`~standard.validate`); streaming-клиент — v2 (после 6) | M | идея — [ideas.md [2026-07-13]](./ideas.md) |
| 23 | `pipeline-type-dx` | бюджет на DX типов pipeline: типы-ошибки в точке `compose` (читаемый литерал `__error` + `missing` вместо трассировки дженериков), snapshot-тесты текстов диагностик по фикстурам неправильных композиций, бенчмарк tsserver (~50 слоёв) с порогом в CI | S–M | идея — [ideas.md [2026-07-13]](./ideas.md) |
| 24 | `endpoint-model` | уход классовых endpoint-деклараций: канон — декларации-значения через per-transport конструкторы (`httpEndpoint`/`cliEndpoint` — типизированный словарь: path-параметры, bind-карта из 21); `deps`-инжект + формы хендлера (функция / каррированная фабрика / класс-хендлер через контейнер); `endpoints:` модуля принимает значения; удаление `@Endpoint`/`@HttpEndpoint`/`IEndpoint`/endpoint-registry; standalone-гарантия в типах (`route` — только deps-free); перевод `examples.app-with-http` и гайдов; классы остаются DI-формой провайдеров/юнитов/хендлеров; онтология — контракт первичен: конструкторы = сахар «анонимный контракт + `implement`»; CLI-биндинг — политика сбора недостающего input из схемы (`missing: 'prompt'`) | M, breaking | идея — [ideas.md [2026-07-13]](./ideas.md) |
| 25 | `config-secrets` | `secret(schema)` в `makeConfig` (редактирование в `explain()`/логах/доках); семантика общих ключей: независимая валидация каждой секцией, fail-fast на несогласованном `reloadable`, секретность по объединению, читатели ключа в `explain()` | S | идея — [ideas.md [2026-07-13]](./ideas.md) |
| 26 | `contract-versioning` | версия явно в имени контракта; схемный дифф против снапшота опубликованных схем; отчёт breaking changes в `.check()`-матрице CI — подсвечивает, не блокирует | S–M | идея — [ideas.md [2026-07-13]](./ideas.md) |
| 27 | `port-deadline-idempotency` | `meta.deadline` (gRPC-модель: абсолютный момент в процессе, относительный timeout по проводу, fail-fast `DeadlineExceededError` до вызова, встроенный код); `idempotencyKey` в meta для `command` (провоз через транспорт; дедупликация — satellite, не ядро) | M | идея — [ideas.md [2026-07-13]](./ideas.md) |
| 28 | `policy-check` | инварианты на собранном графе: `assemble({ policies })`, `everyEndpoint(фильтр).hasLayer(ref)` (идентичность слоя — по ссылке); `detached: '<причина>'` (строка обязательна) + печать detached-ручек на старте; ESLint-правило как editor-фидбек; машинерия для 13 (plugins) и 16 (async-context), прогон в `.check()`-матрице (18) | S–M | идея — [ideas.md [2026-07-14]](./ideas.md) |

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
  25 config-secrets — после 9 (makeConfig, explain(), реестр ключей)
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
- 7 — последний: тест того, что публичных примитивов достаточно.
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
- **22 `contract-clients`** — после 11 (`makeContract` — при реализации учесть
  упаковку: контракт живёт в zero-deps `@nestling/contracts`, не в
  `@nestling/pipeline`), 15 (`defineFail`, `errors:`), 19 (`~standard.validate`
  на клиенте) и 21 (bind-карта). Streaming-клиент — v2, после 6. Логика —
  [ideas.md [2026-07-13]](./ideas.md) «Типизированные клиенты из контрактов»,
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
- **9 `config-module`** — поверх 5 (token-families); детально спроектирован
  (spec-ready). Может идти параллельно 8/10; нужен `assemble` для полной картины.
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
  `testModule`) после 9 и 10 (нужны `assemble`, фазовый lifecycle, источники);
  `stub(Contract)` — после 11; `familyOverride` — уже после 5. Можно доставлять
  инкрементально вместе с соответствующими changes.
- **25 `config-secrets`** — аддитивно поверх 9; в спеку 9 не вносится
  (9 spec-ready, расширять скоуп задним числом не хотим). Логика —
  [ideas.md [2026-07-13]](./ideas.md) «Конфиг: `secret()` и общие ключи».
- **26 `contract-versioning`** — после 11; отчёт совместимости — расширение
  `.check()`-матрицы (18). Открыто: где живёт снапшот схем (репо vs registry).
  Логика — [ideas.md [2026-07-13]](./ideas.md) «Порты: deadline,
  идемпотентность, версионирование контрактов».
- **27 `port-deadline-idempotency`** — после 11 (dispatch, meta); провоз по
  сети (относительный timeout, NATS headers) — вместе с 12. Дедупликация —
  satellite, вне скоупа. Логика — там же ([ideas.md [2026-07-13]](./ideas.md)).
- Рекомендуемый вход в ветку: **8 → 9 → 10 → 11 → 12**, `13` — параллельно после 10.

## Как работать

Новый change: `/opsx:propose "<имя>: <описание со scope и non-goals>"`,
контекст для агента уже настроен в `openspec/config.yaml`.
Реализация: `/opsx:apply <имя>`. Завершение: `/opsx:archive <имя>`
(вливает дельта-спеки в `openspec/specs/`). После archive — обновить
статус в этой таблице.
