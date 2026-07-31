# features: фичи, `select` и composition root

## Why

Сегодня приложение собирается конструктором `new App({ transports: Record<string,
ITransport>, modules, config })`, а транспорт уходит в эфир нульарным
`transport.listen()`. Обе поверхности прямо противоречат целевому состоянию
([`composition.md`](../../../docs/design/composition.md) §2, §4;
[`transports.md`](../../../docs/design/transports.md) §1) и делают невозможным
модульный монолит:

- **транспорты — мешок в конструкторе**, а не провайдеры: им не инжектнуть
  зависимости (порт из конфиг-секции, логгер), их lifecycle App гоняет руками
  `Promise.all`, а «какие транспорты существуют» — независимая ось конфига
  вместо следствия `select`;
- **`listen()` — footgun**: ничто не мешает автору транспорта повесить go-live
  на `@OnInit` и уйти в эфир до регистрации эндпоинтов. «Положи listen в
  start-фазу» — конвенция, а nestling обещает **guarantee over convention**;
- **выбора подмножества фич нет вообще**: один процесс = всё дерево модулей;
  «`--features=orders` в проде, `--features=all` локально» написать нечем.

Логика решений зафиксирована в `docs/decisions/ideas.md`, секции
«[2026-07-08] Модульный монолит: фичи, `select`, дискавери из дерева модулей»
и «[2026-07-08] Жизненный цикл: фазы, `@OnStart`/go-live, гарантия `dispatch`»;
разбор — [`docs/history/discussions/05-modular-monolith-features-ports.md`](../../../docs/history/discussions/05-modular-monolith-features-ports.md)
§2, §7–§10. Это change #10 из [roadmap](../../../docs/decisions/roadmap.md),
второй в волне 4. Обе его предпосылки готовы: дискавери из дерева модулей
(#8, архив `2026-07-29-endpoint-discovery`) и конфиг (#9, архив
`2026-07-31-config-module`, точка привязки временно живёт в `AppConfig.config`).
На него опираются `ports` (#11 — биндинг по топологии и `select`),
`testing-package` (#18 — тестовый корень поверх фазовой модели),
`policy-check` (#28) и `plugins` (#13).

Ключевое: ~80% модели бесплатны — модули уже значения (⇒ фича = значение,
выбор подмножества = фильтрация массива), контейнер уже жадный (⇒ «не выбрал
фичу → её провайдеры не построились» получается само). Новой машинерии
контейнера change не вводит вовсе, кроме одного хука `@OnStart`.

## What Changes

- **`makeFeature({ name, modules, dependsOn })`** — фича как значение: бандл
  модулей плюс ссылки на фичи, без которых она не работает. `select` замыкает
  `dependsOn` транзитивно и отдаёт модули выбранных фич в контейнер.
- **`assemble({ modules?, features?, select?, transports?, config?, providers? })`
  → `App`** — единственный composition root; поля опциональны, приложение из
  одной фичи выглядит так, будто фич нет (L0 не упоминает `feature`/`select`).
  **BREAKING**: публичный конструктор `new App({ transports: Record<…> })`
  исчезает — `App` остаётся типом результата `assemble`.
- **Фазовый жизненный цикл** 0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE →
  4 START → 5 RUN → 6 SHUTDOWN, с явными границами fail-fast (0 и 1) и строгим
  реверсом на shutdown.
- **`@OnStart`** — третий lifecycle-хук контейнера рядом с `@OnInit`/`@OnDestroy`;
  выполняется по топосорту в фазе START, то есть **после** WIRE. Тем самым
  «wiring между init и start» становится гарантией графа, а не конвенцией.
- **`serve(dispatch, signal)` вместо `listen()`** — **BREAKING**: нульарного
  `listen()` в контракте транспорта не существует. `dispatch` — фазовый ресурс,
  рождающийся в WIRE и несущий исполнимую часть ручек (хендлер + pipeline);
  транспорт получает его только в START. Ранний go-live невозможен структурно:
  транспорту, вышедшему в эфир без `dispatch`, **нечего маршрутизировать**.
- **Транспорты — обычные провайдеры**: `http(options?)` / `cli(options?)`
  возвращают провайдер, а не инстанс; зависимости (конфиг-секция транспорта:
  `HTTP_PORT`, `HTTP_HOST`) инжектятся контейнером, lifecycle гоняется по графу
  наравне с прочими узлами. «Какие транспорты существуют» выводится из `select`.
- **Endpoint ссылается на транспорт токеном, а не строкой** — **BREAKING** для
  поля `transport` декларации (`Raw.transport` и `EndpointMeta.transport`
  остаются строками — имя токена, слои не ломаются). Capability negotiation как
  отдельная механика исчезает: HTTP-ручка без HTTP-транспорта в графе — тот же
  fail-fast на ASSEMBLE, что и любая незарегистрированная зависимость.
- **Проверка форм io против способностей транспорта переезжает на ASSEMBLE**
  (фаза 1), где известны и декларации, и инстансы транспортов из графа;
  standalone-путь проверяет то же самое в `serve`, до открытия сокета.
- **Точка привязки конфига переезжает** из `AppConfig.config` в
  `assemble({ config })` — как и обещано в change #9.

## Non-goals

- **Порты и шина** (`makeContract`, `Port`/`Emitter`, `IMessageBus`,
  `InProcessBus`, dispatch-политики, local/remote-биндинг) — change `ports`
  (#11). Здесь фичи общаются только через общий контейнер; поля `dispatch:` и
  `plugins:` в `assemble` не появляются.
- **NATS** — change `transport.nats` (#12).
- **Policy-check на собранном графе** (`assemble({ policies })`, `detached`) —
  change `policy-check` (#28); поля `policies:` в этом change нет.
- **Тестовый корень** (`assembleTest`, `overrides`, фазы 0–3 без START,
  `.check()`-матрица select-топологий) — change `testing-package` (#18).
  Здесь фазы только становятся адресуемыми, но публичного API «остановиться
  на фазе N» не вводится.
- **Инверсия акцептора** (фреймворк владеет сокетом, транспорт — `(req)=>res`,
  level-3 лестницы enforcement) — осознанно не берём: дефолт V1 — средний
  уровень, `dispatch` как обязательный аргумент.
- **Полная конфигурация транспортов через секции** — берём минимум
  (`HTTP_PORT`, `HTTP_HOST`, `CLI`-опций нет), доказывающий, что транспорт-
  провайдер инжектит зависимости; остальные опции остаются аргументом фабрики.
- **Отдельная ось «набор транспортов» в конфиге** — отвергнута записью
  [2026-07-08]: набор выводится из `select`.

## Capabilities

### New Capabilities

- `feature-bundles`: `makeFeature` как значение, транзитивное замыкание
  `dependsOn`, форма и семантика `select` (`'all' | 'a,b' | string[]`),
  fail-fast на неизвестном имени, дублирующемся имени фичи и пустом выборе;
  «не выбрал фичу → её провайдеров и эндпоинтов нет» как наблюдаемое свойство.
- `composition-root`: `assemble(spec) → App` — единственный публичный корень;
  опциональность каждого поля и прогрессия L0→L2; правила совмещения
  `modules` + `features`; `App.run()` / `App.close()` как публичная поверхность
  запуска; регистрация kernel-модуля конфига и привязок `config:`.
- `lifecycle-phases`: семь фаз с их содержимым и границами; `@OnStart` как
  хук контейнера; порядок START по топосорту и SHUTDOWN строго в реверсе;
  идемпотентность `run()`/`close()`; graceful shutdown по SIGTERM/SIGINT.
- `transport-providers`: транспорт — провайдер с токеном; `http()`/`cli()` как
  фабрики провайдеров; множество транспортов = упомянутые декларациями +
  перечисленные в `transports:`; fail-fast «ручка ссылается на транспорт,
  которого нет в графе»; порт/хост из конфиг-секции транспорта с приоритетом
  явных опций.
- `dispatch-guarantee`: `serve(dispatch, signal)` как единственный вход в
  эфир; отсутствие нульарного `listen()`; `dispatch` — фазовый ресурс,
  создаваемый в WIRE (`makeDispatch`) и несущий исполнимые ручки; транспорт
  получает роутинг/парсинг-проекции деклараций из того же `dispatch`;
  standalone-путь (транспорт без `App`) пользуется тем же `makeDispatch`.

### Modified Capabilities

- `endpoint-discovery`: карта требуемых транспортов ключуется **токеном**
  транспорта вместо строки; сверка «требуемое против доступного» идёт против
  собранного графа, а не против `transports: Record`; вход дискавери —
  модули, отобранные `select`.
- `endpoint-declarations`: поле `transport` декларации несёт токен транспорта
  (`httpEndpoint` проставляет токен `@nestling/transport.http`), строковое имя
  выводится из токена и продолжает ехать в `Raw`/`EndpointMeta`.
- `transport-form-capabilities`: точка проверки форм — фаза ASSEMBLE (для
  `App`) и `serve` (для standalone); `ITransport.endpoint()`/`route()` как
  точки регистрации и проверки исчезают вместе с методом.
- `lifecycle-metadata-idempotency`: метаданные хуков пополняются `@OnStart`
  с теми же гарантиями (хук на метод собирается ровно один раз, выполняется
  один раз на инстанс).
- `app-shutdown-abort`: SHUTDOWN определяется как строгий реверс START —
  сначала взводится `signal`, переданный в `serve`, затем `close()`
  транспортов (дренаж), и только потом `@OnDestroy` в реверсе топосорта.
- `config-sources-binding`: точка привязки источников — `assemble({ config })`;
  формулировка «до появления `assemble()` список живёт в `AppConfig`»
  снимается.

## Impact

- **`@nestling/app`** — новый публичный `assemble()`, `makeFeature()`,
  `select`-резолвер, фазовый рантайм `App`, `makeDispatch()`; `AppConfig`
  с `transports: Record` удаляется.
- **`@nestling/container`** — декоратор `@OnStart`, `BuiltContainer.start()`
  (топосорт), метаданные хуков.
- **`@nestling/transport`** — `ITransport`: `serve(dispatch, signal)` вместо
  `listen()`, `endpoint()` уходит; тип `Dispatch` и проекция маршрута.
- **`@nestling/transport.http` / `@nestling/transport.cli`** — `serve()`,
  фабрики-провайдеры `http()` / `cli()`, токены транспортов, чтение секции
  конфига (HTTP); исполнение ручки — через `dispatch`, а не по своей копии
  декларации.
- **`@nestling/pipeline`** — поле `transport` декларации типизируется токеном;
  `assertFormsSupported` вызывается из новых точек.
- **`packages/examples.*`** — все четыре примера переезжают на `assemble()`
  (`app-with-http` дополнительно получает фичи и `select` как витрину L2).
- **Документация** — `docs/design/composition.md` и `transports.md`
  уточняются по факту реализованного (форма `dispatch`, точка проверки форм),
  новый гайд `docs/guides/composition.md`, пересверка `http-app-di.md`,
  `http-functional.md`, `cli.md`, `config.md`, README пакетов `app`,
  `container`, `transport`, `transport.http`, `transport.cli`, статус
  change #10 в roadmap.
