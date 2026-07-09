[07.07.2026] Pipeline v2: плоские фазы, слои, compose (pipeline-v2). BREAKING.

`definePipeline().use(middleware)` заменён на `makePipeline()` со словарём
фаз `.pre/.ok/.catch/.after/.finally` (вид юнита виден в декларации, она
читается сверху вниз как план исполнения). Ответный тракт появился в
рантайме впервые: ответные юниты применяются к текущему ответу и могут
его заменить (`.ok` — успех успехом, `.catch` — ошибку ошибкой; gate и
восстановление Fail→Ok — осознанные ограничения v1). `.finally` наблюдает
исход `completed | disconnected | aborted | failed` (v1: вычисляется после
ответной фазы, до фактической отправки; точный момент «всё дотекло» —
в streaming-v2). Честная опциональность: `.ok` видит полный ctx,
`.catch`/`.after`/`.finally` — свой слой Partial, внешние слои — полными.

Слои: один `makePipeline()` = один слой; `compose(outer, ..., inner)` —
pre снаружи внутрь, ответные и finally изнутри наружу; требования слоя
(`makePipeline<{identity: User}>()`) проверяются компилятором в точке
композиции. `TNeeds` (третий тип-параметр): классы-юниты резолвятся
контейнером на старте App (`bind`), standalone-транспорты принимают
только исполнимый пайплайн — двухуровневость фреймворка видна в типах.

`executeWithHandler` сохранил сигнатуру (миграция транспортов — типы);
`meta.signal` и `exposeErrorDetails` перенесены без изменений; причины
аборта типизированы (`ClientDisconnectedError`/`TransportClosingError`).
Удалена мёртвая ветка `@Middleware`/middleware-registry/
`AppModule.middleware` (DI-резолв не был реализован; роль занял `TNeeds`).
Мигрированы транспорты, App, все examples и гайды. См. change `pipeline-v2`.

[07.07.2026] meta.signal — сигнал отмены запроса насквозь (abort-signal).

В `meta` каждого хендлера появился гарантированный `signal: AbortSignal`
(ключ зарезервирован; без транспортного сигнала подставляется never-aborted).
Его взводят: HTTP-транспорт при дисконнекте клиента (`'close'` на response
при недописанном ответе) и `close()` транспорта при graceful shutdown —
per-request и transport-level источники объединяются через `AbortSignal.any`,
реестр in-flight контроллеров не нужен. `App.close()` не менялся: отмена
in-flight — обязанность транспорта внутри его `close()`; `CliTransport`
взводит свой сигнал при `close()`. Отмена кооперативная: force-close по
`closeTimeout` остаётся fallback'ом.

Поведенческое изменение `close()`: сигналы in-flight запросов взводятся
до дренажа, кооперативное завершение — основной механизм. Попутно закрыта
дыра дренажа: keep-alive соединение, освободившееся после начала `close()`,
Node сам не закрывает — добавлена периодическая зачистка
`closeIdleConnections()` в окно дренажа. Это предпосылка streaming-v2
(item-цепочки и `events(T)` описаны в терминах `meta.signal`).
См. change `abort-signal`.

[07.07.2026] Internal 500 error details hidden by default (transport-hardening).

Раньше `Pipeline.errorToResponse` под захардкоженным `isDevelopment = true`
всегда клал `error.message` и `error.stack` в тело 500-ответа, а верхний catch
HTTP-транспорта отдавал `error.message` для любых ошибок. Это утечка внутренних
деталей на любом публичном окружении.

Теперь необработанные (не `Fail`) ошибки по умолчанию дают
`{ "error": "Internal server error" }` без message/stack. Раскрытие включается
явной опцией `exposeErrorDetails` (свойство окружения: опция транспорта →
`executeWithHandler`, а не поле переиспользуемого Pipeline). `CliTransport`
передаёт `true` (локальный инструмент). `Fail` не затронут — его message/details
автор раскрыл осознанно.

Поведенческое изменение (не BREAKING по API): клиенты/тесты, полагавшиеся на
текст 500-ответа, его больше не увидят. Заодно ошибки входа классифицированы
корректно: битый JSON и конфликт ключей payload → `400`, превышение
`maxBodySize` → `413` (вместо прежних `500`). См. change `transport-hardening`.

[07.07.2026] Container: атрибуция провайдеров, идемпотентность lifecycle, контракт get() (container-fixes).

Три точечных дефекта `@nestling/container` из аудита 2026-07-06, не зависящих от
целевого дизайна (token families — отдельный change). (1) **Функциональные
провайдеры модуля теряли принадлежность**: `appendFactoryProviders()` регистрировал
их без имени модуля (`module: undefined` в графе → «ничьи» узлы, `strictExports` их
не увидел бы). Теперь имя модуля прокидывается — метка и признак `exported` те же,
что у провайдеров-массивом. (2) **Lifecycle-метаданные накапливались per-instance**:
`@OnInit`/`@OnDestroy` писали имя метода в `addInitializer`, который по стандарту ES
выполняется на каждый инстанс → N инстансов давали N дублей хука → `init()`/`destroy()`
вызывался N раз (проявлялось при нескольких сборках/семействах). Запись сделана
идемпотентной (раз на метод класса). (3) **Контракт аксессоров**: `get()` возвращает
`T | null` (JSDoc ошибочно заявлял `@throws` — контракт `getOrThrow()`); `getOrThrow()`
теперь проверяет наличие УЗЛА графа, а не truthiness — легитимные `0`/`''`/`false`
больше не дают ложный not-found. Не BREAKING (публичный API не изменился; поправлено
ошибочное поведение). Дельта-спеки влиты: `container-module-attribution`,
`lifecycle-metadata-idempotency`, `container-accessor-contract`. См. change
`container-fixes`.

[07.01.2026] Endpoint classes instead of Controllers.

Switched from @Controller with @Endpoint methods to @Endpoint on classes. Main reasons:
1. TypeScript method decorators cannot check parameter types against schemas due to type system limitations
2. @Endpoint on class constructors allows checking the entire class shape through constructor constraint
3. One class = one endpoint (Single Responsibility) - better isolation and testability
4. Both functional style (app.endpoint) and class style (@Endpoint) provide full type checking

Controller approach (multiple endpoints in one class) violates SRP and lacks compile-time type safety. Endpoint approach is more explicit and type-safe.

[27.09.2025] Modules as plain objects.

Modules make dependency tree much more complex if they are class with dependencies. My take is that modules are just blueprints, that shouldn't work in application runtime. No lifecycle hooks, no injection, etc.

There are some doubts though:
1. Maybe we'll need hooks that should work when all module providers are initialized or destroyed. We always have option to extend configuration object and `makeModule` function
2. Maybe we'll need something like `configure` function which can be used by plugins to extends app functionality. But this doesn't seem to be ID-container's business.

Module metadata will be preserved. We will always know what module is source of any provider.

One thing that i had in my mind - remove modules from container and make them next layer of abstraction. But in this case we won't be able to protect module scopes (everything will be global!)