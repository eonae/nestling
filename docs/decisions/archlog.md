[30.07.2026] Декларации endpoint'ов — значения (endpoint-model). BREAKING.

Четвёртый change breaking-окна волны 2 и конец двух параллельных стилей
деклараций. До него классовый путь (`@Endpoint`/`@HttpEndpoint` +
`implements IEndpoint`) принимал только `App`, функциональный (`makeEndpoint`)
— только standalone-транспорты: `AppModule.endpoints` был типизирован
`Constructor<IEndpoint>[]` и значений не брал. Обе поверхности сводились к
одному и тому же `EndpointDefinition{handle}`, но классовая надстройка стоила
~600 строк (декораторы, WeakMap-метаданные, `IEndpoint`, резолв инстансов) и
×2 к докам, примерам и тестам. Решающий довод — не размер, а перманентное
свойство TS: **декоратор не влияет на типы**, поэтому всё продающее в дизайне
(schema-first вход/выход, типизированная `meta`, `Output<T, E>`, контракты)
классовой декларации доставалось бы вечной `implements`-церемонией.

Канон — per-transport конструкторы: `httpEndpoint({ method, path, input,
output, pipeline, deps, handle })` и `cliEndpoint({ command, … })`.
Транспортный словарь легален и типизирован только здесь — пайплайн и хендлер
остаются транспорт-слепыми. `path` берётся литеральным типом, имена
path-параметров извлекаются из шаблона на уровне типов; в конструкторе
оставлена явная точка расширения, куда `input-bind` (#21) внесёт
разворачивание bind-карты. Ошибки словаря (пустой `path`, путь без ведущего
слэша, дублирующийся `:param`, пустая команда) бросаются **в момент создания
значения**, а не на старте приложения. Общая машинерия не размазана по
транспортам: `makeEndpoint` остаётся kernel-примитивом (нормализация форм
`handle`, `deps`, гашение, бренд), конструкторы — надстройки над ним. Из
пользовательского канона `makeEndpoint` ушёл, из экспортов — нет.

Удалены `@Endpoint`, `@HttpEndpoint`, `IEndpoint`, `EndpointMetadata`,
`getEndpointMetadata`, `getHttpEndpointMetadata`, `HttpEndpointOptions`,
`HttpEndpointMetadata`, `makeHttpEndpoint` и symbol-ключ `nestling:handler`.
Метаданных на классах больше нет — вместе с ними ушёл остаток
endpoint-registry, начатый в `endpoint-discovery` (#8). `endpoints:` модуля
принимает значения, `makeAppModule` перестал подмешивать эндпоинты в
`providers`: инстанцировать нечего. Отличить декларацию от постороннего
значения позволяет неперечислимый symbol-бренд — элемент `endpoints:` без
бренда даёт ошибку старта с именем модуля и индексом в массиве; молчаливого
пропуска нет.

DI хендлера — поле `deps` и три формы `handle`: голая функция
`(input, meta) => …`; каррированная фабрика `deps: […]` +
`(…deps) => (input, meta) => …`, где внешний вызов происходит **один раз на
сборке** и замыкание играет роль инстанса; класс под `@Injectable` с методом
`handle`, резолвимый контейнером. Класс — форма подключения DI, а не второй
стиль деклараций: декларация во всех трёх случаях одно и то же значение, а
`implements` не нужен, потому что сверка сигнатуры со схемами идёт в точке
декларации. Хендлер тестируется без фреймворка — фабрику зовут с фейками
напрямую, класс создают через `new`.

Standalone-гарантия переехала в типы. `EndpointDefinition` получил параметр
неразрешённых зависимостей (дефолт `never`, симметрия с `TNeeds` у
`Pipeline`), и `server.route()` / `ITransport.endpoint()` принимают только
deps-free декларацию. Параметр накапливает не только токены `deps` и
класс-хендлер, но и **классы-юниты пайплайна**: после слияния метаданных и
декларации в одно значение это единственное место, где различимы «пайплайн,
требующий `bind`» и «исполнимый пайплайн», — без этого standalone-приём терял
бы compile-time-гарантию. Гашение — `endpoint.resolve(resolver | [instances])`,
возвращающий **новую** декларацию; исходная не мутируется, поэтому одну
декларацию можно погасить дважды разными наборами. Класс-форма и юниты
требуют резолвер-формы (позиционному массиву нечем их инстанцировать) и
говорят об этом текстом ошибки. `App` гасит зависимости контейнером на старте
одним шагом — `pipeline.bind` вызывается изнутри `resolve` тем же резолвером,
— и падает до приёма запросов, называя паттерн ручки, модуль-объявитель,
недостающую зависимость и способ починки.

Дискавери переехала со значений-конструкторов на декларации: транспорт и
паттерн читаются с самой декларации, `DiscoveredEndpoint` несёт её вместо
конструктора и метаданных. Проверка «класс с метаданными эндпоинта вне
`endpoints:`» удалена как беспредметная — метаданных нет, отличить забытую
ручку от обычного провайдера нечем; неиспользуемая декларация ловится
`noUnusedLocals`, а «каждая объявленная ручка обслуживается» — предмет
`policy-check` (#28) на собранном графе. Требование «объявленный эндпоинт
обязан резолвиться контейнером» не исчезло, а переехало в
`endpoint-handler-di` и расширилось на `deps` и класс-хендлер.

Онтология «контракт первичен» зафиксирована в доках, а не в коде:
per-transport конструкторы описаны как сахар «анонимный контракт +
`implement`»; сам `makeContract`/`implement` приезжает с `ports` (#11).
Дельта-спеки влиты: новые `endpoint-declarations` и `endpoint-handler-di`,
модифицирован `endpoint-discovery`. Примеры переведены: `examples.app-with-http`
(9 эндпоинтов) — с декораторов на `httpEndpoint` с сохранением
классов-хендлеров как демонстрации DI-формы, `examples.simple-http-server` и
`examples.simple-cli` — с `makeEndpoint` на транспортные конструкторы; гайды
`http-app-di.md`, `http-functional.md`, `cli.md` пересверены. Вне scope
осознанно оставлены: bind-карта и strict-приём (`input-bind`, #21 — рантайм
`mergePayload`/`PayloadConflictError` здесь не тронут), «транспорт токеном»
(`features`, #10 — транспорт по-прежнему адресуется строкой), формы io
(`streaming-v2`, #6), `errors:` в контракте (`error-model`, #15),
CLI-политика `missing: 'prompt'`. См. change `endpoint-model`.

[29.07.2026] Дискавери эндпоинтов из дерева модулей (endpoint-discovery). BREAKING.

Третий change breaking-окна волны 2. Множество обслуживаемых эндпоинтов задаёт
состав контейнера, а не граф импортов. Глобальный `Set`
(`metadata/endpoint-registry.ts`) удалён вместе с `registerEndpoint`,
`getAllEndpoints` и `clearEndpointRegistry`; `@Endpoint`/`@HttpEndpoint`
перестали само-регистрироваться — декоратор только пишет метаданные класса.
Эндпоинт обслуживается, только если перечислен в `endpoints:` модуля,
достижимого из `modules` приложения.

Протечка была структурной, а не косметической: реестр наполнялся при любом
транзитивном импорте (barrel, тест, соседний модуль), `App.#registerEndpoints`
итерировал его и падал на `container.get()` для класса, чей модуль в контейнер
не регистрировали. Дискавери был ортогонален составу собранного приложения —
ровно то, что ломает выбор подмножества модулей, ради которого затевается
ветка модульного монолита.

`@nestling/app` получил чистую функцию `discoverEndpoints(modules)`:
depth-first обход `modules` + `imports`, `imports` раньше собственных
эндпоинтов, дедупликация модулей по имени (зеркало
`ContainerBuilder.registerModule` — «обнаружено» не расходится с «собрано»),
пометка на входе гасит цикл `A → B → A`, дедуп конструктора внутри модуля,
детерминированный порядок. Результат — значение, а не побочный эффект: список
`{ endpoint, metadata, moduleName }` плюс карта «требуемый транспорт → его
ручки». Считается без контейнера и транспортов, поэтому обход тестируется
напрямую и годится как шов для `features` (#10) и policy-check на полном
графе (#28). `makeAppModule` перестал терять `endpoints` — возвращаемое
значение теперь `AppModule extends Module` с сохранённым полем (классы
по-прежнему дублируются в `providers`, чтобы контейнер их инстанцировал).

Три молчаливых режима стали ошибками старта, и каждая называет
модуль-объявитель: класс в `endpoints:` без метаданных эндпоинта (был
`console.warn` + skip), класс **с** метаданными, попавший в `providers` мимо
любого `endpoints:` (иначе миграция даёт молча необслуженную ручку; провайдеры
из `ProvidersFactory` не линтуются — до `build()` их состав неизвестен, и
ограничение задокументировано), недостающий требуемый транспорт (текст
называет транспорт, паттерн ручки и модуль). Сконфигурированный транспорт, на
который дискавери не дала ни одной ручки, остаётся легальным и поднимается: у
него есть маршруты и помимо дискавери (`HttpTransport.route()`). Изоляция
тестов стала структурной — `clearEndpointRegistry()` из `beforeEach` ушёл
вместе с реестром.

Форма деклараций не менялась: `@Endpoint`, `@HttpEndpoint`, `IEndpoint` и
`makeEndpoint` остались, `endpoints:` по-прежнему принимает конструкторы —
уход на per-transport конструкторы-значения это следующий change
`endpoint-model` (#24), с которым декораторы и умрут. Новая capability
`endpoint-discovery` влита в основные спеки целиком (8 требований: источник
дискавери, модуль-значение, правила обхода, форма результата, три fail-fast'а
и обязанность резолвиться контейнером). Целевое состояние —
[design/container.md](../design/container.md) («глобальных реестров-при-импорте
нет») и [design/composition.md](../design/composition.md) §1; логика —
ideas.md «[2026-07-08] Модульный монолит: фичи, `select`, дискавери из дерева
модулей», разбор — [discussions/05 §1](../history/discussions/05-modular-monolith-features-ports.md).
См. [архив change'а](../../openspec/changes/archive/2026-07-29-endpoint-discovery/).

[29.07.2026] Pipeline: отказ от фазы `.after` (pipeline-drop-after). BREAKING.

Второй change breaking-окна волны 2. Словарь ответного тракта сведён к
Promise-тройке `.ok`/`.catch`/`.finally`: постпроцессор, обработчик ошибок,
наблюдатель исхода. `.after` — единственный член словаря без аналога у
`Promise` — удалён вместе с типом `AfterUnitFn` из публичного экспорта
`@nestling/pipeline`; в рантайме `ResponsePhase` сужен до `'ok' | 'catch'`,
а проверка применимости схлопнулась до одного сравнения
`(entry.phase === 'ok') === response.isSuccess`.

Ниша фазы оказалась пуста после двух более ранних решений: границы
«pipeline = значения, transport = байты» и правила «ответный тракт не меняет
тип value». Наблюдение на любом исходе — это `.finally`, маппинг ошибок —
`.catch`, обогащение успеха — `.ok`; работы, которую делал бы только `.after`,
не осталось. Зато цена была: `ok`/`catch`/`after` — не три фазы, а один
список с применимостью по текущему ответу, и `.after` был единственной
причиной, по которой это правило не формулировалось одним предложением.
Использований не было ни в middleware пакета, ни в примерах — только в спеках.

Миграция: `.after(u)` → `.ok(u).catch(u)`. Сигнатура совпадает (свой слой
`Partial`, возможность заменить ответ), поэтому замена механическая.
Единственное расхождение задокументировано: если `u` бросит в роли ok-юнита,
ответ станет ошибкой и `u` исполнится второй раз уже как catch-юнит, тогда
как `.after` исполнялся ровно один раз — потенциально бросающую функцию
не регистрируют в обе фазы одним значением.

Семантика оставшихся фаз не менялась. Тесты `.after`-сценариев переписаны
на `.ok`/`.catch` без потери покрытия, добавлены рантайм-проверки порядка
при ответе-ошибке в композиции, применимости по текущему ответу и двойного
вызова `.ok(u).catch(u)`. Текст рантайм-guard'а `pre()` теперь перечисляет
актуальный словарь. Дельта-спеки влиты: `pipeline-phase-model` (словарь,
type-state, правило исполнения), `pipeline-composition` (порядок при
композиции, добавлен сценарий ответа-ошибки), `request-abort-signal`
(редакционно — перечень фаз, которым доступен `ctx.signal`). Целевое
состояние — [design/pipeline.md](../design/pipeline.md); логика и отвергнутые
варианты — ideas.md «[2026-07-10] Pipeline: отказ от `.after`».
См. [архив change'а](../../openspec/changes/archive/2026-07-29-pipeline-drop-after/).

[29.07.2026] Схемы: Standard Schema вместо привязки к zod (standard-schema). BREAKING.

Первый change breaking-окна волны 2. Ядро больше не знает про валидатор:
`Schema` в `@common/misc` — это `StandardSchemaV1`, `Infer`/`DomainType` идут
через `InferOutput`, а валидация — вызов `schema['~standard'].validate(value)`.
Вендорские типы (`z.ZodType`, `z.infer`, `ZodError`) из публичных сигнатур
ушли; `zod` убран из `peerDependencies` пяти пакетов ядра и из единственного
рантайм-импорта (`middlewares/meta.ts`), оставшись devDependency там, где его
импортируют тесты. Единственная схемная зависимость — types-only
`@standard-schema/spec`, а сам тип реэкспортирован из `@common/misc`, чтобы
потребителю не требовалось ставить пакет спеки.

Ключевое свойство спеки, определившее дизайн: Standard Schema даёт валидацию
и инференс, но **не интроспекцию**. Схема в рантайме — чёрный ящик, поэтому
всё, что требует знания структуры, в ядро не попало (конвертеры в JSON Schema
поедут отдельными пакетами с change `openapi`). Следствие: `InferSchemaType`
схлопнут до `~standard` (yup, у которого спеки нет, выпал из поддержки), а
дак-тайп `interface Schema<T> { parse(data): T }` из `EndpointMeta` удалён —
он лгал (в `input` клали и модификаторы, и примитивы).

Вся валидация сведена в одну функцию `validateSync` (`@nestling/pipeline`):
через неё идут `parsePayload`/`parseMetadata`, юнит `validate()`, поэлементная
валидация NDJSON-потока и fallback-ветки транспортов без pipeline — прямых
`schema.parse(...)` в ядре и транспортах не осталось, так что одна и та же
невалидная запись даёт одинаковую ошибку на любом пути. `SchemaValidationError`
несёт `issues: readonly { message, path? }[]` вместо поля `zodError`; путь
нормализуется при конструировании (сегмент-объект `{ key }` → `key`, символ →
строка, индекс остаётся числом), поэтому `issues` JSON-сериализуемы и уезжают
в `details` 400-ответа без вендорских `code`/`expected`/`received`.

Граница «ошибка входа vs ошибка конфигурации» проведена явно. Синхронность
валидации — гарантия: thenable из `validate` даёт `AsyncSchemaNotSupportedError`
вместо Promise, уехавшего handler'у вместо значения. Объект без `~standard`
(или с чужой версией) даёт `NotAStandardSchemaError` с внятной причиной, а не
`TypeError` о чтении свойства у `undefined`. Оба класса намеренно **вне**
иерархии `SchemaValidationError` — транспорт отдаёт на них 500 с маскировкой
деталей по политике `error-response-safety`, а не 400.

BREAKING по трём точкам: `SchemaValidationError.zodError` больше не существует
(есть `issues`), схемы обязаны реализовывать Standard Schema v1 (zod ≥ 3.24 /
4.x — да, yup — нет), async-схемы перестали молча работать. Дельта-спеки влиты:
новая capability `standard-schema-validation`, уточнено требование «Schema
validation failures keep 400» в `http-request-validation-errors`. Целевое
состояние — [design/schemas.md](../design/schemas.md) §1; логика и отвергнутые
варианты — ideas.md «[2026-07-13] Схемы: Standard Schema вместо привязки к
zod». См. [архив change'а](../../openspec/changes/archive/2026-07-29-standard-schema/).

[29.07.2026] Multi-injection: `Family.all` — узел-агрегат семейства (multi-injection).

Инжект массива независимо зарегистрированных вкладов закрыт без флага
`multi: true` и без side-effect-реестра. `Family.all` — сентинел-токен семейства
(`"HealthCheck:{all}"`, тип `TokenString<readonly T[]>`); вклад остаётся обычным
провайдером с членским токеном (`classProvider(IHealthCheck('db'), DbHealthCheck)`),
который любой модуль регистрирует сам, не правя центральное место.

Механика: на `build()`, строго после фикспоинта материализации членов и до
инстанциации, билдер регистрирует на каждый упомянутый в deps сентинел обычный
factory-провайдер с deps = токены всех зарегистрированных членов семейства и
значением — замороженным массивом их инстансов. Дальше агрегат неотличим от
прочих узлов: проверка циклов (цикл через агрегат печатает путь, а не только
входной токен), топологические `init()`/`destroy()`, `toJSON()`/`traverse()`,
визуализация, `strictExports`. Узел безмодульный, поэтому вклад чужого модуля
требует `exports` — «модуль контрибьютит в семейство» стало явным контрактом.

Границы. Агрегат deps-driven: неупомянутый `.all` узла не порождает (`get()` →
`null`) и материализацию членов не форсит — в массив попадают только члены, у
которых есть узел. Три открытых вопроса записи ideas.md закрыты: пустое
семейство → `[]` (узел без deps, сборка успешна); порядок — порядок регистрации
(явные вклады, затем материализованные фикспоинтом); форма инжекта —
`readonly T[]`, имя вклада — забота самого вклада. Токен `.all` и параметр
`{all}` зарезервированы: собственный провайдер на агрегатный токен и
`Family('{all}')` — ошибки.

Не BREAKING: аддитивное свойство семейства, новая фаза `build()` и новые ошибки
на ранее невозможных формах записи; поведение собранных контейнеров не менялось.
Демонстрация — семейство health-check'ов в `examples.simple-app` с вкладами из
`module:database` и `module:api`; гайд —
[guides/di-token-families.md](../guides/di-token-families.md). См. change
`multi-injection`.

[28.07.2026] Token families, `.auto` и strictExports в контейнере (token-families).

Параметризованные провайдеры перестали быть ручным паттерном. `makeTokenFamily`
даёт семейство токенов (`ILogger('users')` → мемоизированный `Logger:users`),
`familyProvider(family, recipe)` регистрирует ОДИН рецепт на всё семейство, а
`build()` получил фазу материализации: собирает членов, упомянутых в deps
зарегистрированных провайдеров, вызывает рецепт ровно раз на уникальный параметр
и регистрирует результат обычным узлом графа. Дальше член неотличим от обычного
провайдера — дедупликация, циклы, lifecycle, атрибуция к модулю, визуализация.
Сбор итеративный (провайдер из рецепта сам может зависеть от членов) с жёстким
лимитом в 100 раундов: самоподпитывающийся рецепт даёт диагностику, а не зависание.

Ключевые границы. Рецепт возвращает готовое определение провайдера, а не
`{ deps, factory }`: переиспользуется существующий словарь (`valueProvider` для
заглушки в тестах, `classProvider` с lifecycle), а единственный риск формы —
чужой `provide` — закрыт build-time проверкой с внятной ошибкой. Членство
определяется реестром семейства, а не парсингом id: `makeToken('Logger:users')`
членом не является (ошибка «provider not found» с подсказкой про семейство).
Материализация только от deps: член без потребителей не создаётся, `get()` для
него возвращает `null` — контракт аксессоров не менялся.

`Family.auto` — consumer-aware сахар: `@Injectable([ILogger.auto])` резолвится в
`ILogger('<ИмяКласса>')` в момент декорирования, закрывая нестовский
`transient + INQUIRER` без transient-скоупа. Вне классового `@Injectable`
сентинел запрещён (ошибка регистрации с подсказкой на явный вызов), анонимный
класс — ошибка при декорировании.

`new ContainerBuilder({ strictExports: true })` — opt-in lint рёбер готового
графа против `exports` модулей: кросс-модульное ребро на неэкспортированный
токен собирает нарушение, все нарушения приходят одной ошибкой. Отсутствующий
`exports` = ничего не экспортировано (иначе lint беззуб именно там, где нужен);
`exports: [Family]` экспортирует всех материализованных членов. Это проверка на
сборке, а не рантайм-инкапсуляция: в `get()` и при инжекте проверок нет.

Не BREAKING: всё аддитивно (новые экспорты, необязательный параметр конструктора,
расширение типов `Module.exports`/`providers`); поведение по умолчанию не
изменилось. `examples.simple-app` мигрирован с ручного `Set` + `ProvidersFactory`
на семейство, `UserRepository` демонстрирует `.auto`. Гайд —
[guides/di-token-families.md](../guides/di-token-families.md). См.
[архив change'а](../../openspec/changes/archive/2026-07-29-token-families/).

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