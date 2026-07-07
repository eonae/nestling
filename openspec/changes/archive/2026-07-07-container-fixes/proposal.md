# container-fixes

## Why

Аудит (2026-07-06) выявил в `@nestling/container` три точечных дефекта, не зависящих от целевого дизайна (token families / модули без рантайм-инкапсуляции — отдельный change, см. `docs/decisions/ideas.md`, секция «[2026-07-06] Token families + модули без рантайм-инкапсуляции»). Все три — дешёвые исправления, которые стоит выпустить до крупных архитектурных changes:

- **Функциональные провайдеры модуля теряют принадлежность к модулю.** Когда модуль объявляет `providers` функцией (`ProvidersFactory` — ленивая форма), `ContainerBuilder.appendFactoryProviders()` регистрирует полученные провайдеры без имени модуля. В графе такие узлы получают `module: undefined`, `exported: undefined` — визуализация показывает их «ничьими», а будущая проверка `strictExports` (ideas.md) физически не сможет их учесть. Целевой дизайн прямо называет модуль «меткой принадлежности + метаданными для графа/визуализации» — сейчас метка не проставляется для целого класса провайдеров.
- **Метаданные lifecycle-хуков накапливаются per-instance.** `@OnInit`/`@OnDestroy` пишут имя метода в per-constructor хранилище внутри `context.addInitializer`, который по спецификации стандартных ES-декораторов выполняется на **каждый** инстанс. При создании N инстансов класса массив хуков разрастается до N дубликатов → `getLifecycleHooks` возвращает хук N раз → `init()`/`destroy()` вызывается N раз. Проявляется при нескольких сборках контейнера в одном процессе (тесты, рестарты, будущие семейства провайдеров). Текущие тесты создают ровно один инстанс на класс и баг не ловят.
- **JSDoc `BuiltContainer.get()` противоречит поведению.** Метод возвращает `T | null` и не бросает, но JSDoc заявляет `@throws {Error} If the service is not registered` и `@returns The service instance` — это контракт `getOrThrow()`. У самого `getOrThrow()` JSDoc нет вовсе, и он использует проверку на truthiness (`if (!instance)`), из-за чего кидает «not found» на легитимных falsy-значениях (`0`, `''`, `false`).

## What Changes

- `ContainerBuilder.appendFactoryProviders()` прокидывает имя модуля (ключ `#providersFactories`) в `registerProvider(provider, moduleName)`, чтобы провайдеры из функциональной фабрики получали ту же метку модуля и признак `exported`, что и провайдеры-массивом.
- `@OnInit`/`@OnDestroy` записывают имя метода в `lifecycleMetadata` идемпотентно (один раз на метод класса), независимо от числа созданных инстансов. `getLifecycleHooks` возвращает каждый хук ровно один раз.
- JSDoc `BuiltContainer.get()` переписан под фактическое поведение (возврат `null` при отсутствии токена, без `@throws`); `getOrThrow()` получает JSDoc и корректно отличает «токен не зарегистрирован» от «зарегистрировано falsy-значение».
- Рантайм-тесты на все три: атрибуция модуля для функциональных провайдеров; отсутствие накопления хуков при нескольких инстансах; контракт `get`/`getOrThrow` (включая falsy-значение).

Не-**BREAKING**: публичный API не меняется. Меняется наблюдаемое поведение в трёх местах, где текущее было ошибочным (дубли хуков, ложный throw на falsy, пустая метка модуля).

## Capabilities

### New Capabilities

- `container-module-attribution`: провайдеры из функциональной фабрики модуля наследуют метку модуля и признак экспорта в метаданных графа.
- `lifecycle-metadata-idempotency`: метаданные `@OnInit`/`@OnDestroy` собираются один раз на метод класса, не на инстанс.
- `container-accessor-contract`: контракт и документация `BuiltContainer.get()` / `getOrThrow()`.

### Modified Capabilities

<!-- существующих спеков в openspec/specs/ пока нет — эти capability вводятся впервые -->

## Impact

- `packages/nestling.container/src/builder/container.builder.ts` — `appendFactoryProviders()` (передача имени модуля).
- `packages/nestling.container/src/lifecycle/lifecycle.ts` — идемпотентная запись в `@OnInit`/`@OnDestroy`.
- `packages/nestling.container/src/builder/container.built.ts` — JSDoc `get()`, JSDoc + логика `getOrThrow()`.
- Тесты: `builder/container.builder.spec.ts` (уже гоняет функциональные провайдеры — добавить проверку метаданных), `lifecycle/lifecycle.spec.ts` (кейс нескольких инстансов), `builder/container.built.spec.ts` (контракт accessor'ов).
- Зависимости: новых нет. Публичные типы и сигнатуры не меняются.

## Non-goals

- Token families, `makeTokenFamily`, `familyProvider`, `strictExports` — отдельный change (см. `docs/decisions/ideas.md`).
- Рантайм-инкапсуляция модулей и любая проверка видимости на старте.
- Изменение семантики `get()` для случая «зарегистрировано значение `null`/`undefined`» (неотличимо от отсутствия by design; вне текущего scope).
- Scoped-контейнеры, `Lazy<T>`, consumer-aware провайдеры (ideas.md).
