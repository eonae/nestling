# container-accessor-contract

## ADDED Requirements

### Requirement: get() returns null for unregistered tokens without throwing

`BuiltContainer.get(token)` SHALL возвращать инстанс сервиса, если токен
зарегистрирован, и `null`, если нет. `get()` SHALL NOT бросать при отсутствии
токена. Документация метода SHALL описывать возврат `null` и SHALL NOT
заявлять `@throws`.

#### Scenario: get() on unregistered token

- **WHEN** вызывается `container.get(UnregisteredToken)`
- **THEN** возвращается `null`, исключение не бросается

### Requirement: getOrThrow() distinguishes absence from falsy values

`BuiltContainer.getOrThrow(token)` SHALL бросать, если токен не зарегистрирован,
и возвращать инстанс, если зарегистрирован — включая легитимные falsy-значения
(`0`, `''`, `false`). `getOrThrow()` SHALL иметь документацию, описывающую это
поведение.

#### Scenario: getOrThrow() on unregistered token

- **WHEN** вызывается `container.getOrThrow(UnregisteredToken)`
- **THEN** бросается ошибка «not found»

#### Scenario: getOrThrow() on registered falsy value

- **WHEN** зарегистрирован `valueProvider(IZero, 0)` и вызывается
  `container.getOrThrow(IZero)`
- **THEN** возвращается `0`, исключение не бросается
