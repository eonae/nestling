## MODIFIED Requirements

### Requirement: Family.auto resolves to the consumer class member at decoration time

`Family.auto` SHALL быть сентинел-токеном (типизированным как
`TokenString<T>`), который декоратор роли — `@Component`, `@Resource` или
`@Handler` — при декорировании класса заменяет на `Family('<ИмяКласса>')`:
потребитель известен статически, и в метаданные класса SHALL записываться
уже резолвленный членский токен. Резолюция SHALL происходить в момент
регистрации (декорирования), без какой бы то ни было рантайм-резолюции;
создание полученного члена узлом графа на `build()` подчиняется общим
правилам capability `token-families`.

#### Scenario: auto resolves to class-named member

- **WHEN** класс объявлен как
  `@Handler([ILogger.auto]) class CreateUserEndpoint {}` и контейнер с
  `familyProvider(ILogger, recipe)` собран
- **THEN** в конструктор инжектится член `"Logger:CreateUserEndpoint"`,
  созданный рецептом с параметром `'CreateUserEndpoint'`

#### Scenario: auto в списке ресурса

- **WHEN** класс объявлен как
  `@Resource([ILogger.auto]) class Database {}` со `static acquire(logger, signal)`
- **THEN** в `acquire` приходит член `"Logger:Database"`
