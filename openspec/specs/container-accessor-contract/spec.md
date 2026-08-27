# container-accessor-contract Specification

## Purpose
TBD - created by archiving change container-fixes. Update Purpose after archive.
## Requirements
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

### Requirement: Недостающие зависимости перечисляются до инстанциации

`ContainerBuilder.build()` SHALL проверять, что у каждого токена,
перечисленного в `deps` оставшихся после прунинга провайдеров, есть
провайдер, — **до** инстанциации. Если таких токенов несколько, ошибка
SHALL перечислять их все, называя для каждого потребителя.

Существующие подсказки SHALL сохраняться: токен, похожий на член семейства,
SHALL по-прежнему сопровождаться подсказкой о способе его создания.

#### Scenario: Все дыры видны сразу

- **WHEN** в графе не хватает провайдеров для трёх токенов
- **THEN** сборка падает одной ошибкой, перечисляющей все три с их
  потребителями, а не первой встреченной при инстанциации

#### Scenario: Подсказка про семейство сохраняется

- **WHEN** недостающий токен выглядит как член семейства, созданный
  `makeToken` вручную
- **THEN** сообщение по-прежнему объясняет, что членов создаёт вызов
  семейства

