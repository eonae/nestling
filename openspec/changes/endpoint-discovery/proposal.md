## Why

Дискавери эндпоинтов сейчас идёт из **глобального `Set`**
(`packages/nestling.pipeline/src/metadata/endpoint-registry.ts`), в который
декоратор `@Endpoint`/`@HttpEndpoint` записывает класс **при импорте файла**.
Это не деталь реализации, а протечка: любой транзитивный импорт (barrel,
тест, соседний модуль) кладёт эндпоинт в реестр, `App.#registerEndpoints`
итерирует реестр и падает на `container.get(EndpointClass)`, потому что
модуль этого класса в контейнер не регистрировали. Дискавери **ортогонален**
тому, какие модули собраны, — и именно поэтому он ломает выбор подмножества
модулей, ради которого затевается вся ветка «модульный монолит».

Решение зафиксировано в [docs/decisions/ideas.md](../../../docs/decisions/ideas.md),
секция «[2026-07-08] Модульный монолит: фичи, `select`, дискавери из дерева
модулей» («Дискавери эндпоинтов/транспортов — обходом дерева зарегистрированных
модулей, НЕ из глобального registry. Предпосылка №1 и одновременно баг-фикс»);
разбор — [discussions/05 §1](../../../docs/history/discussions/05-modular-monolith-features-ports.md);
целевая формулировка — [design/container.md](../../../docs/design/container.md)
(«глобальных реестров-при-импорте нет») и
[design/composition.md](../../../docs/design/composition.md) §1 (инвариант фазы
ASSEMBLE). Change #8 из [roadmap.md](../../../docs/decisions/roadmap.md),
breaking-окно волны 2, размер S.

## What Changes

- **Дискавери из дерева модулей.** `App` собирает эндпоинты обходом
  `config.modules` + `imports` (не `getAllEndpoints()`): источник истины —
  что зарегистрировано, а не что импортировано.
- **Модуль перестаёт терять свои эндпоинты.** `makeAppModule` сейчас
  «схлопывает» `endpoints` в `providers` и возвращает голый `Module` —
  список пропадает. Возвращаемое значение SHALL сохранять поле `endpoints`
  (эндпоинты по-прежнему дублируются в `providers`, чтобы контейнер их
  инстанцировал); тип возврата — `AppModule` (расширение `Module`).
- **Дискавери — значение, а не побочный эффект.** Новая чистая функция
  `discoverEndpoints(modules): EndpointDiscovery` возвращает список
  `{ endpoint, metadata, moduleName }` и карту «требуемый транспорт →
  его эндпоинты». Это несущий уровень: на нём стоят `features` (#10) и
  policy-check на полном графе (#28), и он тестируется без контейнера.
- **Требуемые транспорты вычисляются из дерева.** `App` сверяет множество
  транспортов, затребованных дискавери, с `config.transports`: отсутствующий
  транспорт — ошибка старта с указанием модуля и паттерна.
- **BREAKING** Файл `endpoint-registry.ts` удаляется; `registerEndpoint`,
  `getAllEndpoints`, `clearEndpointRegistry` уходят из публичного API
  `@nestling/pipeline`. `@Endpoint` и `@HttpEndpoint` перестают
  само-регистрироваться — они только пишут метаданные класса.
- **BREAKING** Эндпоинт, не объявленный в `endpoints:` какого-либо модуля
  дерева, не регистрируется в транспорте. Раньше хватало импорта файла.
- **Молчаливые режимы становятся ошибкой старта:** класс в `endpoints:`
  без метаданных эндпоинта — fail-fast (сейчас `console.warn` + skip);
  класс **с** метаданными эндпоинта, попавший в `providers`, но ни в один
  `endpoints:`, — тоже fail-fast (иначе миграция даст молчаливо
  необслуживаемую ручку).
- Обход детерминирован и зеркалит контейнер: модули дедуплицируются по
  имени (как `ContainerBuilder.registerModule`), imports — раньше
  собственных эндпоинтов, циклы импортов не зацикливают обход.
- Тестам больше не нужен `clearEndpointRegistry()` в `beforeEach`:
  изоляция становится структурной (модуль — значение).

## Non-goals

- **Удаление классовых деклараций.** `@Endpoint`, `@HttpEndpoint`,
  `IEndpoint` и `makeEndpoint` остаются как есть; `endpoints:` продолжает
  принимать конструкторы, а не значения. Перевод на per-transport
  конструкторы — change `endpoint-model` (#24), следующий в волне 2.
- **Транспорты как провайдеры.** `transports: Record<string, ITransport>`
  в конструкторе `App` остаётся мешком; ссылка на транспорт остаётся
  строкой, а не токеном; `listen()` не заменяется на
  `serve(dispatch, signal)`. Всё это — change `features` (#10)
  ([d/05 §7–§9](../../../docs/history/discussions/05-modular-monolith-features-ports.md)).
- **Фичи и `select`.** `makeFeature`/`select`/`assemble` не вводятся;
  фазовая модель жизненного цикла (BOOTSTRAP…SHUTDOWN) не реализуется.
  Change #10.
- **Policy-check.** `assemble({ policies })` и предикаты не вводятся —
  этот change лишь даёт им полный граф эндпоинтов. Change #28.
- **Не поднимать транспорт без эндпоинтов.** Отбор транспортов по
  топологии — следствие `select` (#10); здесь поднимаются все
  сконфигурированные транспорты (у транспорта есть маршруты и помимо
  дискавери — `HttpTransport.route()`).

## Capabilities

### New Capabilities

- `endpoint-discovery`: источник дискавери — дерево зарегистрированных
  модулей; форма результата (эндпоинты с атрибуцией к модулю + требуемые
  транспорты); правила обхода, дедупликации и детерминированного порядка;
  fail-fast'ы (нет метаданных, нет транспорта, эндпоинт мимо `endpoints:`);
  отсутствие глобальных реестров-при-импорте как проверяемое требование.

### Modified Capabilities

Нет. Требование `pipeline-unit-forms` «App резолвит классы-юниты
контейнером на старте … та же семантика, что для endpoint-классов»
остаётся верным дословно: меняется источник списка эндпоинтов, не
семантика их резолюции.

## Impact

- **Код (удаление):** `packages/nestling.pipeline/src/metadata/endpoint-registry.ts`
  целиком, его реэкспорт из `metadata/index.ts`, вызов `registerEndpoint`
  в `metadata/endpoint.ts` и в
  `packages/nestling.transport.http/src/helpers.ts` (`@HttpEndpoint`).
- **Код (новое):** модуль дискавери в `@nestling/app`
  (`discoverEndpoints` + типы `DiscoveredEndpoint`/`EndpointDiscovery`),
  экспорт из `packages/nestling.app/src/index.ts`.
- **Код (правка):** `packages/nestling.app/src/module.ts` (`AppModule`
  сохраняет `endpoints`), `packages/nestling.app/src/app.ts`
  (`#registerEndpoints` работает от результата дискавери; проверка
  требуемых транспортов; тексты ошибок с атрибуцией к модулю).
- **Публичный API:** `@nestling/pipeline` теряет три функции реестра
  (breaking); `@nestling/app` получает `discoverEndpoints` и уточнённый
  тип возврата `makeAppModule`.
- **Тесты:** `packages/nestling.app/src/app.spec.ts` (уходит
  `clearEndpointRegistry` из `beforeEach`; тест «в реестре, но не в
  контейнере» переписывается на «объявлен в `endpoints:`, но не
  резолвится»); новый юнит-тест дискавери без контейнера (обход, дедуп,
  порядок, циклы, атрибуция).
- **Примеры:** `packages/examples.app-with-http` уже объявляет `endpoints:`
  в `makeAppModule` — миграция сводится к проверке, что все девять
  эндпоинтов перечислены и приложение поднимается. Прочие `examples.*`
  App не используют (standalone-транспорт).
- **Доки:** README `@nestling/app` и `@nestling/pipeline` (плашки статуса,
  формулировка «auto-discovers … from modules»), гайд
  `docs/guides/http-app-di.md` (обязательность `endpoints:` + дата
  «сверено с кодом»), `docs/decisions/roadmap.md` (статус #8).
  `design/container.md` и `design/composition.md` уже описывают целевое
  состояние — правок не требуют, требуют сверки.
- **Не затрагиваются:** `@nestling/container` (обход дерева живёт в
  `@nestling/app`, чтобы не тащить типы эндпоинтов в DI-пакет),
  `@nestling/transport.cli`, `@nestling/viz`, `@nestling/models`.
