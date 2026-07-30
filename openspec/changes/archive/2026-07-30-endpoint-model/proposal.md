# endpoint-model: декларации endpoint'ов — значения

## Why

Сейчас в репозитории живут **два параллельных стиля деклараций**: классовый
(`@Endpoint`/`@HttpEndpoint` + `implements IEndpoint`, который принимает `App`)
и функциональный (`makeEndpoint`, который принимают standalone-транспорты).
Симметрия сломана в обе стороны — `AppModule.endpoints` типизирован как
`Constructor<IEndpoint>[]` и значения не берёт, а `makeEndpoint` не покрыт
тестами пакетов и под `App` не работает. Классовый путь — обёртка на ~600
строк (декораторы, WeakMap-метаданные, `IEndpoint`, резолв инстансов) поверх
того же `EndpointDefinition{handle}`, в который оба стиля и так сводятся.

Держать обе поверхности вечно — постоянный налог на доки, примеры и тесты
(×2 к каждому), при том что **декоратор не влияет на типы** — перманентное
свойство TS, из-за которого всё продающее в дизайне (schema-first вход/выход,
типизированная `meta`, `Output<T, E>`, контракты) классовой декларации
доставалось бы вечной `implements`-церемонией.

Решения зафиксированы в `docs/decisions/ideas.md`: «[2026-07-13] Один
канонический стиль деклараций: функциональный (`make*`)», «[2026-07-13]
Endpoint-декларации: per-transport конструкторы, `deps`-инжект, формы
хендлера», «[2026-07-13] Контракт первичен: онтология деклараций, три этажа,
формы io»; полная логика и стресс-тест — `docs/history/discussions/08-endpoint-declarations-and-styles.md`.
Целевое состояние уже описано в `docs/design/endpoints.md` — этот change
приводит к нему код. Change #24 из `docs/decisions/roadmap.md`; едет в
breaking-окне волны 2 после `endpoint-discovery` (#8), который уже убрал
глобальный реестр и оставил декоратор чистым носителем метаданных.

## What Changes

- **BREAKING. Декларация endpoint'а — значение, создаваемое конструктором
  своего транспорта.** Появляются `httpEndpoint({ method, path, input,
  output, pipeline, deps, handle })` и `cliEndpoint({ command, … })`.
  Транспортный словарь легален и типизирован **только здесь**: `path` —
  литеральный тип, path-параметры извлекаются из шаблона на уровне типов;
  в конструкторе оставлена явная точка расширения, куда следующий change
  (`input-bind`) вносит разворачивание bind-карты.
- **BREAKING. Удаляются `@Endpoint`, `@HttpEndpoint`, `IEndpoint`,
  `getEndpointMetadata`, `getHttpEndpointMetadata`, `EndpointMetadata`,
  `makeHttpEndpoint` и symbol-ключ `nestling:handler`.** Метаданных на
  классах больше нет — вместе с ними уходит и остаток endpoint-registry.
- **BREAKING. `endpoints:` модуля принимает значения-декларации**, а не
  конструкторы. `makeAppModule` перестаёт подмешивать эндпоинты в
  `providers` — инстанцировать больше нечего.
- **DI хендлера — поле `deps`, три формы `handle`**: голая функция
  `(input, meta) => …`; каррированная фабрика `deps: […]` +
  `(…deps) => (input, meta) => …` (внешний вызов — один раз на сборке,
  замыкание = инстанс); класс с `@Injectable` и методом `handle`,
  резолвимый контейнером. Класс — форма подключения DI, а не второй стиль
  деклараций; `implements` не нужен — сверка со схемами идёт в точке
  декларации.
- **Standalone-гарантия в типах.** Тип декларации несёт неразрешённые
  зависимости третьим параметром; `server.route()` и `ITransport.endpoint()`
  принимают **только deps-free** декларацию (симметрично `Pipeline<_, _,
  never>`); ручное гашение — `endpoint.resolve(resolver)`.
- **Дискавери работает со значениями.** `discoverEndpoints` возвращает
  декларации с атрибуцией к модулю; проверка «класс с метаданными вне
  `endpoints:`» становится беспредметной и удаляется, проверка «в
  `endpoints:` лежит не декларация» — остаётся и переформулируется на
  значения.
- **Онтология «контракт первичен» фиксируется в доках**, а не в коде:
  per-transport конструкторы описываются как сахар «анонимный контракт +
  `implement`»; сам `implement` и `makeContract` приезжают с change `ports`.
- **Перевод примеров и гайдов**: `examples.app-with-http` уезжает с
  декораторов на `httpEndpoint` (с сохранением классов-хендлеров как
  демонстрации DI-формы), `examples.simple-http-server` и
  `examples.simple-cli` — с `makeEndpoint` на транспортные конструкторы;
  `docs/guides/http-app-di.md`, `http-functional.md`, `cli.md`
  пересверяются.

### Non-goals

- **`@Injectable`-провайдеры и классы-юниты пайплайна не затрагиваются** —
  класс остаётся канонической DI-формой; `pipeline-unit-forms` не меняется.
- **`makeContract`/`implement` и порты** — change `ports` (#11). Здесь
  онтология только описывается в доках.
- **Полная bind-карта, strict-приём, `query()`, `rawBody`** — следующий
  change `input-bind` (#21). Рантайм сборки payload (`mergePayload`,
  `PayloadConflictError`) в этом change **не трогается**; конструктор лишь
  готовит для неё типизированную точку расширения.
- **«Транспорт токеном» и endpoint как узел графа с синтетическим id**
  (ideas «Endpoint-декларации», п. 5–6) — едет с change `features` (#10)
  вместе с транспортами-провайдерами. Здесь транспорт по-прежнему
  адресуется строкой, а `deps` резолвятся контейнером на старте `App`, там
  же, где раньше резолвились endpoint-классы.
- **CLI-политика `missing: 'prompt'`** (упомянута в строке roadmap 24) —
  в scope, переданный этому propose, не входит; интерактивный сбор
  недостающего input остаётся отдельной работой по CLI-биндингу.
  `cliEndpoint` как конструктор в этот change входит.
- **Формы io (`stream`/`events`/`multipart`)** — change `streaming-v2` (#6);
  существующий `stream(...)` в декларациях продолжает работать как есть.
- **`errors:` в контракте** — change `error-model` (#15). Поле в словаре
  конструктора не заводится.

## Capabilities

### New Capabilities

- `endpoint-declarations`: форма декларации endpoint'а — значение,
  создаваемое per-transport конструктором (`httpEndpoint`, `cliEndpoint`);
  типизированный транспортный словарь с извлечением path-параметров;
  отсутствие декораторных деклараций, `IEndpoint` и метаданных на классах;
  `endpoints:` модуля как список значений.
- `endpoint-handler-di`: инъекция зависимостей в хендлер — поле `deps`,
  три формы `handle` (функция / каррированная фабрика / класс-хендлер),
  резолв контейнером на старте `App`, standalone-гарантия в типах
  (deps-free декларация для `route`/`ITransport.endpoint`) и ручное
  гашение через `endpoint.resolve(resolver)`.

### Modified Capabilities

- `endpoint-discovery`: единица дискавери меняется с конструктора класса на
  значение-декларацию — переформулируются требования об источнике дискавери
  (упоминание декораторов уходит), о `makeAppModule` (эндпоинты больше не
  подмешиваются в `providers`), о результате дискавери (декларация вместо
  конструктора) и о валидации содержимого `endpoints:`; требование «класс с
  метаданными эндпоинта вне `endpoints:` — ошибка старта» удаляется как
  беспредметное; требование «объявленный эндпоинт обязан резолвиться
  контейнером» переносится на `deps` и класс-хендлер.

## Impact

**Публичный API (breaking):**

- `@nestling/pipeline` — удаляются `Endpoint`, `getEndpointMetadata`,
  `EndpointMetadata`, `IEndpoint`; `EndpointDefinition` получает параметр
  неразрешённых зависимостей; `makeEndpoint` остаётся kernel-примитивом
  (из пользовательского канона уходит, из экспортов — нет).
- `@nestling/transport` — `ITransport.endpoint()` сужается до deps-free
  декларации.
- `@nestling/transport.http` — удаляются `HttpEndpoint`,
  `HttpEndpointOptions`, `HttpEndpointMetadata`, `getHttpEndpointMetadata`,
  `makeHttpEndpoint`; добавляется `httpEndpoint`; `HttpTransport.route`
  сужается до deps-free.
- `@nestling/transport.cli` — добавляется `cliEndpoint`.
- `@nestling/app` — `AppModule.endpoints` меняет тип на список деклараций;
  `DiscoveredEndpoint` несёт декларацию вместо конструктора.

**Код:** `packages/nestling.pipeline/src/{core/types/endpoint.ts,metadata/endpoint.ts}`,
`packages/nestling.transport/src/interfaces.ts`,
`packages/nestling.transport.http/src/{helpers.ts,transport.ts,router.ts}`,
`packages/nestling.transport.cli/src/index.ts`,
`packages/nestling.app/src/{app.ts,module.ts,discovery.ts,helpers.ts}` и их
тесты (`app.spec.ts`, `module.spec.ts`, `discovery.spec.ts`).

**Примеры:** `examples.app-with-http` (9 эндпоинтов), `examples.simple-http-server`,
`examples.simple-cli`.

**Доки:** `docs/design/endpoints.md` (уже описывает цель — сверить и снять
расхождения), `docs/design/transports.md`, `docs/design/composition.md`,
`docs/guides/{http-app-di.md,http-functional.md,cli.md}` (плашки «сверено с
кодом» + новая дата), README пакетов `nestling.pipeline`, `nestling.app`,
`nestling.transport*`, `docs/decisions/roadmap.md` (статус), `docs/preview/`.

**Зависимости:** новых внешних нет. Апстрим — `endpoint-discovery` (#8,
заархивирован); даунстрим — `input-bind` (#21) вносит bind-карту в
подготовленную здесь точку расширения.
