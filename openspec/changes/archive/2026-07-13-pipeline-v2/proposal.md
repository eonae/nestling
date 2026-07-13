# pipeline-v2 — плоские фазы, слои, композиция константами

## Why

Текущая модель pipeline — before-only middleware (`definePipeline().use(...)`):
ответного тракта в рантайме нет вообще, «after»-логика (маппинг ошибок,
аудит, транзакции, обёртки ресурсов) невыразима, а универсальный `.use()`
не показывает в декларации, каким юнитом является элемент цепочки. Дизайн
целевой модели зафиксирован и аргументирован в
[ideas.md, раздел «Pipeline v2: плоские фазы, слои, композиция константами»](../../../docs/decisions/ideas.md):
плоские фазы вместо луковицы/`next()`, честная опциональность ctx на
ответном тракте, слои с `compose`, двухуровневость фреймворка в типах
(`TNeeds`). Это change #4 из [roadmap](../../../docs/decisions/roadmap.md) —
самый большой и ломающий; от него зависит streaming-v2 (#6, item-цепочки
описаны в терминах новой модели).

## What Changes

- **BREAKING** `@nestling/pipeline`: `makePipeline()` со словарём фаз
  `.pre/.ok/.catch/.after/.finally` заменяет `definePipeline().use()`.
  Type-state билдера: `.pre` недоступен после первого ответного метода
  (декларация читается сверху вниз = порядок исполнения). Класс `Pipeline`,
  `definePipeline`, `IMiddleware`/`MiddlewareFn` (before-only модель)
  удаляются из публичного API.
- Честная опциональность ctx: `.ok` видит полный ctx (успех ⇒ весь pre-тракт
  прошёл), `.catch`/`.after` — свой слой `Partial`, внешние слои полные;
  `.finally` — как `.catch` + исход `completed | disconnected | aborted |
  failed` (для унарных ответов, с опорой на `meta.signal`; полная
  стрим-семантика момента «всё дотекло» — в streaming-v2).
- Слои и композиция: пайплайн — стек слоёв, один `makePipeline()` = один
  слой; `compose(outer, ..., inner)` читается сверху вниз как «снаружи
  внутрь»; pre-тракты исполняются снаружи внутрь, ответные — изнутри наружу.
  Требования слоя к внешнему контексту — `makePipeline<{ identity: User }>()`,
  проверка компилятором в точке композиции.
- `TNeeds` — второй тип-параметр: формы юнитов — функция, инстанс, класс
  (накапливается Constructor; App резолвит контейнером на старте).
  Standalone-транспорты принимают только `Pipeline<any, never>`.
  Токен-форма (`RateLimit('strict')`) — задел в типах, реализация после
  token-families (#5).
- **BREAKING** рантайм выполнения: транспорты вызывают новый энтрипоинт
  выполнения (замена `executeWithHandler`); политика `exposeErrorDetails`
  и контракт `meta.signal` сохраняются в новой модели.
- Встроенные middleware (`validate`, `withRequestId`, `withIdentity`,
  `withPermissions`, `withRequestLogging`) переоформляются как юниты фаз.
- **BREAKING** cleanup: middleware-registry (`@Middleware`,
  `getAllMiddleware`, `AppModule.middleware`) удаляется — это мёртвая ветка
  (DI-резолв middleware не был реализован); её роль занимает `TNeeds`.
- Миграция всех потребителей: transport.http, transport.cli (включая
  default-pipeline транспорта), app, все examples, интеграционные тесты,
  гайды и README.
- Рантайм-тесты нового ядра (фазы, слои, error-path, `meta.signal`,
  `exposeErrorDetails`) + новые type-тесты билдера и композиции.

### Non-goals

- Item-цепочки (per-chunk/per-event обработка), `stream(T)`/`events(T)`,
  `Topic`, SSE, полная стрим-семантика `.finally` — streaming-v2 (#6).
- Реализация токен-формы юнитов и token families — #5 (`token-families`);
  здесь только совместимый задел в `TNeeds`.
- Ранний успешный выход (gate: кэш, идемпотентность) и восстановление
  `Fail → Ok` в `.catch` — осознанные ограничения v1 (ломают гарантию
  полного ctx у `.ok`; кандидат в v2 ядра).
- Уровни привязки пайплайна App/module — отвергнуты (ideas.md); только
  явная привязка к endpoint. Sanity-проверки политики App'ом на старте —
  возможное будущее, не здесь.
- Перепроектирование `Ok`/`Fail`, io-модификаторов, схемной валидации,
  Raw/EndpointMeta — переносятся как есть.

## Capabilities

### New Capabilities

- `pipeline-phase-model`: словарь фаз `.pre/.ok/.catch/.after/.finally`,
  type-state билдера, семантика исполнения одного слоя (pre по порядку,
  падение ⇒ ответная фаза с `Fail`, применимость к текущему ответу),
  гарантии полноты/Partial ctx, исход в `.finally`.
- `pipeline-composition`: слои, `compose(outer, ..., inner)`, порядок
  исполнения трактов, явные требования слоя к внешнему контексту
  и их compile-time проверка.
- `pipeline-unit-forms`: формы юнитов (функция/инстанс/класс), `TNeeds`,
  ограничение standalone-транспортов `Pipeline<any, never>`, резолв
  классов-юнитов App'ом на старте, контракт «юнит — синглтон,
  per-request состояние только в ctx».

### Modified Capabilities

- `request-abort-signal`: контракт `meta.signal` сохраняется, но
  требования переформулируются под новую модель (вместо
  «`executeWithHandler` после накопления input» — фазы/слои; доступность
  сигнала юнитам всех фаз).
- `error-response-safety`: политика `exposeErrorDetails` прокидывается
  в новый рантайм выполнения; поведение `Fail` (message/details) и
  generic-500 сохраняются, формулировки привязываются к фазовой модели.
- `http-request-validation-errors`: `validate()` из before-middleware
  становится pre-юнитом; требование 400-маппинга сохраняется,
  формулировка обновляется.

## Impact

- `packages/nestling.pipeline` — ядро переписывается: `core/pipeline.ts`
  (билдер, рантайм фаз, типовая машинерия накопления input),
  `core/types/middleware.before.ts` (заменяется типами юнитов),
  `metadata/endpoint.ts` (`EndpointDefinition.pipeline`, тип-параметры
  `IEndpoint`/`HandlerFn`), `middlewares/*` → юниты,
  middleware-registry — удаление; `pipeline.spec.ts` (673 стр. type-тестов),
  `TYPE-TESTS.md`, `pipeline.runtime.spec.ts` — переписываются.
- `packages/nestling.transport.http` — `transport.ts` (вызов рантайма,
  обе ветки), `helpers.ts` (`HttpEndpointOptions/Metadata.pipeline`),
  `router.ts` (тип-параметры), `transport.integration.spec.ts`
  (14 использований `definePipeline`).
- `packages/nestling.transport.cli` — `execute()`, default-pipeline
  в конструкторе (ограничение `Pipeline<any, never>`).
- `packages/nestling.app` — `#registerEndpoints` + новый шаг: резолв
  `TNeeds` (классов-юнитов) контейнером на старте с ошибкой при отсутствии
  регистрации; `module.ts` — удаление `AppModule.middleware`.
- `packages/examples.*` — `examples.app-with-http`
  (`common/pipelines.ts` + 9 endpoint'ов), `examples.simple-http-server`
  (3 хендлера + свой `withTiming`), `examples.simple-cli` (default-pipeline
  + 2 endpoint'а).
- Доки: гайды `http-functional.md` (раздел Middleware), `http-app-di.md`,
  `cli.md`, `docs/design/transports.md` (раздел Pipeline, диаграмма),
  README `nestling.pipeline`; запись в archlog.
- `nestling.viz`, `nestling.models` — не затронуты (pipeline не используют).
- Новых зависимостей нет.
