# token-families

## Why

Целевой дизайн зафиксирован в `docs/decisions/ideas.md`, секция «[2026-07-06]
Token families + модули без рантайм-инкапсуляции» (Решения 1–3). Потребности
«параметризованные провайдеры» (`ILogger(scope)`, `IQueue(name)`) и
«consumer-aware провайдеры» (логгер, названный по классу-потребителю) —
статические: в nestling зависимости объявляются явным массивом, поэтому на
`build()` билдер видит все запрошенные члены семейства и может инстанцировать
их жадно, сохраняя полный граф (визуализация, топологический init/destroy,
проверка циклов). Сегодня паттерн приходится собирать вручную
(`examples.simple-app/src/logging/registry.ts`: `Set` токенов + фабрика +
модуль с `ProvidersFactory`) — это import-side-effect-механика, не проверяемая
контейнером и повторяемая в каждом проекте заново. Change #5 из
`docs/decisions/roadmap.md`.

## What Changes

- **`makeTokenFamily<T, Params>('Name')`** (`@nestling/container`): семейство
  токенов. Вызов `ILogger('users')` возвращает обычный мемоизированный
  `TokenString<T>` с id `"Logger:users"`; семейство ведёт реестр созданных
  членов (формализация ручного `Set` из примера).
- **`familyProvider(family, recipe)`**: регистрация ОДНОГО рецепта на всё
  семейство (напрямую в билдере или через `providers` модуля). На `build()`
  билдер собирает члены семейства, упомянутые в deps зарегистрированных
  провайдеров (включая deps провайдеров, порождённых рецептами), для каждого
  уникального параметра один раз вызывает рецепт и регистрирует ОБЫЧНЫЙ узел
  графа. Никакой рантайм-резолюции: жадная инстанциация, дедупликация,
  проверка циклов, lifecycle-хуки, module-атрибуция — как у обычных узлов.
- **`Family.auto`** — consumer-aware сахар: `@Injectable([ILogger.auto])`
  резолвится в `ILogger('<ИмяКлассаПотребителя>')` в момент регистрации
  (декорирования). Вне классового `@Injectable` (deps фабричных провайдеров)
  — запрещено в v1, ошибка сборки.
- **`strictExports`** (опционально включаемый lint):
  `new ContainerBuilder({ strictExports: true })` — на `build()` проверка
  рёбер готового графа против деклараций `exports` модулей. Build-time
  проверка, не рантайм-инкапсуляция; `exports` дополнительно принимает
  семейство токенов («экспортированы все члены»).
- Токены членов семейств — обычные `InjectionToken`, совместимые с будущей
  токен-формой юнитов pipeline (`RateLimit('strict')` в `TNeeds`,
  change pipeline-v2); сама токен-форма юнитов реализуется там, не здесь.

Не-**BREAKING**: все изменения аддитивные — новые функции и опция
конструктора; существующее API и поведение по умолчанию не меняются.

## Capabilities

### New Capabilities

- `token-families`: семейства токенов (`makeTokenFamily`), один рецепт на
  семейство (`familyProvider`), build-time материализация членов в обычные
  узлы графа (дедупликация, рекурсивный сбор deps, циклы, lifecycle,
  module-атрибуция, ошибки отсутствующего/дублирующего рецепта).
- `consumer-aware-tokens`: сахар `Family.auto` — резолюция члена семейства по
  имени класса-потребителя в момент регистрации; ограничения v1.
- `strict-exports`: опциональная build-time проверка рёбер графа против
  `exports` модулей (включая экспорт семейства целиком).

### Modified Capabilities

Нет. Требования существующих спек (`container-module-attribution`,
`container-accessor-contract`, `lifecycle-metadata-idempotency`) не меняются:
члены семейств — обычные узлы и наследуют эти контракты как есть; атрибуция
членов к модулю — новое требование в capability `token-families`, а не
изменение существующего.

## Impact

- `packages/nestling.container/src/common.ts` — тип `TokenFamily<T>` (или
  соседний новый файл); токены остаются брендированными строками.
- `packages/nestling.container/src/providers/` — `familyProvider`,
  вид определения `FamilyProviderDefinition`, type guard; резолюция
  `.auto`-сентинелов в `Injectable`.
- `packages/nestling.container/src/builder/container.builder.ts` — приём
  family-провайдеров в `register()`/`Module.providers`, фаза материализации
  членов в `build()`, опция `{ strictExports }` и проверка рёбер.
- `packages/nestling.container/src/modules/modules.ts` — `exports` принимает
  семейства.
- `packages/examples.simple-app/src/logging/` — миграция ручного реестра на
  `makeTokenFamily`/`familyProvider` (демонстрация фичи).
- Тесты: `container.builder.spec.ts`, `variants.spec.ts` (+ новые спеки
  семейств), рантайм-тесты полного цикла build/init/destroy.
- Документация: README `@nestling/container`, `docs/guides/`.
- Новых зависимостей нет. `@nestling/app`, транспорты, pipeline — не
  затрагиваются.

## Non-goals

- Request-состояние в DI — никогда (это input пайплайна; ideas.md, Решение 4).
- `lazy()` / `Lazy<T>` — отложено (ideas.md, Решение 4).
- Child-контейнеры / подграфы `createScope` — отложено (ideas.md, Решение 4).
- DynamicModule / forRoot-аналоги — не нужны: параметризованный модуль — это
  просто функция, возвращающая `Module` (ideas.md, Решение 3).
- Рантайм-инкапсуляция модулей (как в Nest) — не делаем; видимость — через
  ES-модули, `strictExports` — только opt-in lint.
- Токен-форма юнитов pipeline (`RateLimit('strict')` в `TNeeds`) — стык с
  change pipeline-v2, реализуется там ПОСЛЕ этого change; здесь — только
  совместимость токенов с такой перспективой.
- Валидация параметров семейства (enum допустимых скоупов) — отложено;
  многопараметрические семейства — отложено (см. design.md).
- `Family.all` (multi-injection: массив всех зарегистрированных членов) —
  отдельный change `multi-injection` (roadmap #14, ideas.md [2026-07-10]).
