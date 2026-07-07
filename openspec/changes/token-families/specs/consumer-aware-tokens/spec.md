# consumer-aware-tokens Specification (delta)

## ADDED Requirements

### Requirement: Family.auto resolves to the consumer class member at decoration time

`Family.auto` SHALL быть сентинел-токеном (типизированным как
`TokenString<T>`), который декоратор `@Injectable` при декорировании класса
заменяет на `Family('<ИмяКласса>')` — потребитель известен статически, и в
метаданные класса SHALL записываться уже резолвленный членский токен.
Резолюция SHALL происходить в момент регистрации (декорирования), без какой
бы то ни было рантайм-резолюции; материализация полученного члена на
`build()` подчиняется общим правилам capability `token-families`.

#### Scenario: auto resolves to class-named member

- **WHEN** класс объявлен как
  `@Injectable([ILogger.auto]) class CreateUserEndpoint {}` и контейнер с
  `familyProvider(ILogger, recipe)` собран
- **THEN** в конструктор инжектится член `"Logger:CreateUserEndpoint"`,
  созданный рецептом с параметром `'CreateUserEndpoint'`

#### Scenario: Two consumers with auto get distinct members

- **WHEN** классы `ServiceA` и `ServiceB` оба объявляют dep `ILogger.auto`
- **THEN** материализуются два разных узла — `"Logger:ServiceA"` и
  `"Logger:ServiceB"` — с независимыми инстансами из одного рецепта

#### Scenario: auto member deduplicates with explicit member of the same name

- **WHEN** класс `ServiceA` объявляет `ILogger.auto`, а другой провайдер
  явно deps'ит `ILogger('ServiceA')`
- **THEN** в графе существует один узел `"Logger:ServiceA"`, разделяемый
  обоими потребителями

### Requirement: Family.auto is limited to class decorators in v1

Использование `Family.auto` SHALL быть допустимо только в deps классового
`@Injectable`. Сентинел, оказавшийся в deps фабричного провайдера, рецепта
семейства или иного определения без класса-потребителя, SHALL приводить к
ошибке регистрации или сборки с подсказкой использовать явный вызов
`Family('<имя>')`. Декорирование класса без имени (анонимного) с
`Family.auto` в deps SHALL приводить к ошибке при декорировании.

#### Scenario: auto in factory provider deps is rejected

- **WHEN** зарегистрирован `factoryProvider(IFoo, factory, [ILogger.auto])`
  и вызван `build()`
- **THEN** регистрация или сборка завершается ошибкой, упоминающей
  недопустимость `.auto` вне классового `@Injectable` и явный вызов
  семейства как замену

#### Scenario: auto on anonymous class is rejected

- **WHEN** `@Injectable([ILogger.auto])` применяется к классу с пустым
  `constructor.name`
- **THEN** декорирование бросает ошибку о невозможности определить имя
  потребителя
