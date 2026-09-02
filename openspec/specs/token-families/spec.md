# token-families

## Purpose

Токен — объект: идентичность ссылочная, строковый `id` служит отчётам и
ошибкам. Параметризованные провайдеры — первоклассный примитив контейнера:
`makeTokenFamily` даёт семейство мемоизированных токенов, `familyProvider`
регистрирует один рецепт на всё семейство, а `build()` материализует ровно тех
членов, что упомянуты в deps зарегистрированных провайдеров. Материализованный
член неотличим от обычного узла графа — дедупликация, циклы, lifecycle,
атрибуция к модулю и визуализация работают без исключений. Рантайм-резолюции
членов не существует.

## Requirements

### Requirement: Токен — объект с идентичностью по ссылке

Токен SHALL быть объектом с уникальной идентичностью и строковым `id`.
Совпадение `id` SHALL NOT означать совпадения токенов: сравнение идёт по
ссылке.

Класс, использованный как токен, SHALL опознаваться по ссылке на
конструктор. `constructor.name` SHALL использоваться только для
отображения.

Два токена с одинаковым `id` SHALL давать предупреждение сборки:
отчёты и граф станут неоднозначными.

#### Scenario: Однофамильцы из разных пакетов не сливаются

- **WHEN** два разных класса с именем `Logger` из разных пакетов
  зарегистрированы как провайдеры
- **THEN** это два разных токена и два разных узла графа

#### Scenario: Строка не является токеном

- **WHEN** потребитель передаёт строку туда, где ожидается токен
- **THEN** компилятор отвергает вызов

### Requirement: Член семейства хранит принадлежность структурно

Токен-член семейства SHALL нести семейство и параметр полями. Разбор
строкового идентификатора вида `'Family:param'` SHALL NOT применяться.

Токены `.auto` и `.all` SHALL быть выделенными значениями, а не членами с
зарезервированными строковыми параметрами.

Повторный вызов семейства с тем же параметром SHALL возвращать тот же
токен.

#### Scenario: Принадлежность читается полем

- **WHEN** ядру нужно узнать, что токен — член семейства портов
- **THEN** оно читает поле семейства, а не разбирает строку

#### Scenario: Мемоизация члена

- **WHEN** дважды вычислено `ILogger('users')`
- **THEN** получен один и тот же токен

#### Scenario: Пользовательский параметр не сталкивается со служебным

- **WHEN** член семейства создан с параметром `'all'`
- **THEN** он отличается от агрегата `.all`

### Requirement: makeTokenFamily creates memoized member tokens

`makeTokenFamily<T, Params>(name)` SHALL возвращать семейство токенов —
функцию, вызов которой `Family(param)` (в v1 `param: string`) возвращает
токен-член: объект с `id` вида `"<name>:<param>"` и полями принадлежности
`family` и `param`. Повторный вызов с тем же параметром SHALL возвращать тот
же токен и не создавать новой записи в реестре членов семейства. Члены
семейства SHALL быть полноценными `InjectionToken` — пригодными в deps
`@Injectable`, deps фабричных провайдеров и в
`container.get()`/`getOrThrow()`.

#### Scenario: Member token id and memoization

- **WHEN** создано семейство `ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Logger')`
  и дважды вызвано `ILogger('users')`
- **THEN** оба вызова возвращают токен с id `"Logger:users"` и токены
  идентичны (одна запись в реестре членов)

#### Scenario: Member usable as ordinary injection token

- **WHEN** класс объявлен как `@Injectable([ILogger('users')])` и контейнер
  с зарегистрированным `familyProvider` собран
- **THEN** зависимость инжектится в конструктор как обычная, а
  `container.getOrThrow(ILogger('users'))` возвращает тот же инстанс

### Requirement: familyProvider registers a single recipe per family

`familyProvider(family, recipe)` SHALL создавать регистрируемое определение
«один рецепт на семейство», принимаемое как `ContainerBuilder.register()`,
так и `providers` модуля (массивом и фабрикой). Рецепт SHALL иметь форму
`(param) => ProviderDefinition<T>` — возвращать готовое определение
провайдера (`factoryProvider`/`valueProvider`/`classProvider`). Повторная
регистрация рецепта для того же семейства SHALL приводить к ошибке.

#### Scenario: Recipe registered via module providers

- **WHEN** модуль объявляет `providers: [familyProvider(ILogger, recipe)]`
  и контейнер собран с потребителем `ILogger('users')`
- **THEN** сборка успешна и член семейства создан по рецепту

#### Scenario: Duplicate recipe for the same family is rejected

- **WHEN** `familyProvider(ILogger, recipeA)` и `familyProvider(ILogger, recipeB)`
  регистрируются в одном билдере
- **THEN** регистрация второго рецепта бросает ошибку, называющую семейство

### Requirement: Build materializes referenced family members eagerly

`build()` SHALL собирать все члены зарегистрированных семейств, упомянутые в
deps зарегистрированных провайдеров (включая deps провайдеров, порождённых
рецептами, — итеративно до фикспоинта), и для каждого уникального параметра
SHALL вызывать рецепт ровно один раз, регистрируя результат как обычный узел
графа. Несколько потребителей одного члена SHALL получать один и тот же
инстанс (дедупликация). Рантайм-резолюции членов после `build()` SHALL NOT
существовать: члены, не упомянутые в deps, не материализуются, и
`container.get()` для них возвращает `null`.

#### Scenario: Two consumers share one member instance

- **WHEN** два класса объявляют dep `ILogger('users')` и контейнер собран
- **THEN** рецепт для `'users'` вызван ровно один раз, оба потребителя
  получают один и тот же инстанс, в графе один узел `"Logger:users"`

#### Scenario: Distinct parameters produce distinct nodes

- **WHEN** потребители запрашивают `ILogger('users')` и `ILogger('db')`
- **THEN** рецепт вызван по одному разу для `'users'` и `'db'`, в графе два
  отдельных узла с независимыми инстансами

#### Scenario: Recipe-produced provider references another family member

- **WHEN** рецепт семейства A возвращает провайдер с dep-членом семейства B
  (у B зарегистрирован свой рецепт)
- **THEN** член B материализуется на следующей итерации сбора, и сборка
  завершается успешно с полным графом

#### Scenario: Unreferenced member is not materialized

- **WHEN** `ILogger('orphan')` был создан вызовом семейства, но не упомянут
  в deps ни одного зарегистрированного провайдера
- **THEN** после `build()` узла `"Logger:orphan"` в графе нет и
  `container.get(ILogger('orphan'))` возвращает `null`

### Requirement: Recipe result is validated against the member token

`build()` SHALL проверять, что определение, возвращённое рецептом для
параметра `p`, имеет `provide`, совпадающий с токеном члена `family(p)`;
при несовпадении сборка SHALL завершаться ошибкой, называющей семейство,
параметр и фактический `provide`.

#### Scenario: Recipe returns provider with wrong token

- **WHEN** рецепт для `ILogger('users')` возвращает
  `factoryProvider(ILogger('other'), ...)`
- **THEN** `build()` бросает ошибку с именем семейства `Logger`, параметром
  `'users'` и фактическим токеном `"Logger:other"`

### Requirement: Missing family recipe fails the build with a targeted error

`build()` SHALL завершаться ошибкой, если член семейства упомянут в deps
зарегистрированного провайдера, а `familyProvider` для этого семейства не
зарегистрирован; ошибка SHALL называть семейство и параметр члена.

#### Scenario: Member requested without registered recipe

- **WHEN** класс объявляет dep `ILogger('users')`, но `familyProvider(ILogger, ...)`
  не зарегистрирован
- **THEN** `build()` бросает ошибку, указывающую семейство `Logger` и
  параметр `'users'`

### Requirement: Family members are ordinary graph nodes

Материализованные члены семейства SHALL участвовать во всех механизмах
контейнера наравне с обычными узлами: жадная инстанциация на `build()`,
детекция циклов (включая циклы через членов семейства), lifecycle-хуки
(`@OnInit` при `init()` в топологическом порядке, `@OnDestroy` при
`destroy()` в обратном), наличие в графе (`toJSON()`/`traverse()`).

#### Scenario: Cycle through a family member is detected

- **WHEN** рецепт `ILogger('a')` возвращает провайдер с dep `ServiceB`, а
  `ServiceB` объявляет dep `ILogger('a')`
- **THEN** `build()` бросает ошибку о циклической зависимости

#### Scenario: Lifecycle hooks of a member run once

- **WHEN** рецепт возвращает `classProvider` с классом, имеющим
  `@OnInit`/`@OnDestroy`, член материализован и вызваны
  `container.init()` и затем `container.destroy()`
- **THEN** init-хук члена вызван ровно один раз при `init()` и
  destroy-хук — ровно один раз при `destroy()`

### Requirement: Family members inherit module attribution

Члены семейства SHALL получать `metadata.module` модуля, через `providers`
которого зарегистрирован их `familyProvider`, — так же, как обычные
провайдеры модуля. При регистрации
`familyProvider` напрямую в билдере (вне модуля) `metadata.module` члена
SHALL быть `undefined`.

#### Scenario: Member attributed to the recipe's module

- **WHEN** модуль `{ name: 'module:logging', providers: [familyProvider(ILogger, recipe)] }`
  зарегистрирован и член `ILogger('users')` материализован
- **THEN** узел `"Logger:users"` имеет `metadata.module === 'module:logging'`

#### Scenario: Member from directly registered recipe has no module

- **WHEN** `familyProvider(ILogger, recipe)` зарегистрирован через
  `builder.register(...)` без модуля
- **THEN** узел материализованного члена имеет `metadata.module === undefined`
