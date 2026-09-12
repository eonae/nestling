# container-accessor-contract Specification

## Purpose
TBD - created by archiving change container-fixes. Update Purpose after archive.
## Requirements

### Requirement: get() returns null for unregistered tokens without throwing

`BuiltContainer.get(token)` SHALL возвращать инстанс сервиса, если токен
зарегистрирован, и `null`, если нет. `get()` SHALL NOT бросать при
отсутствии токена. Документация метода SHALL описывать возврат `null` и
SHALL NOT заявлять `@throws` для этого случая.

Контракт SHALL действовать с фазы INIT: до создания экземпляров `get()`
SHALL бросать ошибку фазы (capability `instantiation-on-init`), потому что
`null` там означал бы «не зарегистрирован» и путал бы отсутствие узла с
отсутствием значения.

Проверка регистрации без экземпляра SHALL выполняться методом
`has(token)`.

#### Scenario: get() on unregistered token

- **WHEN** после `init()` вызывается `container.get(UnregisteredToken)`
- **THEN** возвращается `null`, исключение не бросается

#### Scenario: get() до INIT

- **WHEN** `container.get(UserService)` вызван сразу после `build()`
- **THEN** брошена ошибка, называющая токен и фазу

#### Scenario: has() до INIT

- **WHEN** `container.has(UserService)` вызван сразу после `build()`
- **THEN** возвращается `true` для зарегистрированного токена и `false`
  для незарегистрированного

### Requirement: getOrThrow() distinguishes absence from falsy values

`BuiltContainer.getOrThrow(token)` SHALL бросать, если токен не
зарегистрирован, и возвращать инстанс, если зарегистрирован — включая
легитимные falsy-значения (`0`, `''`, `false`). `getOrThrow()` SHALL иметь
документацию, описывающую это поведение.

До фазы INIT `getOrThrow()` SHALL бросать ошибку фазы, отличимую по тексту
от ошибки «токен не зарегистрирован».

#### Scenario: getOrThrow() on unregistered token

- **WHEN** после `init()` вызывается `container.getOrThrow(UnregisteredToken)`
- **THEN** бросается ошибка «not found»

#### Scenario: getOrThrow() on registered falsy value

- **WHEN** зарегистрирован `valueProvider(IZero, 0)`, выполнен `init()` и
  вызывается `container.getOrThrow(IZero)`
- **THEN** возвращается `0`, исключение не бросается

#### Scenario: getOrThrow() до INIT

- **WHEN** `container.getOrThrow(IZero)` вызван сразу после `build()`
- **THEN** брошена ошибка фазы, а не ошибка «not found»

### Requirement: Недостающие зависимости перечисляются до инстанциации

`ContainerBuilder.build()` SHALL проверять, что у каждого DI-токена,
перечисленного в `deps` оставшихся после прунинга провайдеров, есть
провайдер. Если таких DI-токенов несколько, ошибка SHALL перечислять их все,
называя для каждого потребителя. Проверка SHALL завершаться до фазы INIT,
на которой создаются экземпляры.

Существующие подсказки SHALL сохраняться: DI-токен, похожий на член семейства,
SHALL по-прежнему сопровождаться подсказкой о способе его создания.

Подсказки, объявленные вместе с DI-токенами (capability
`dependency-hints`), SHALL печататься в той же ошибке: у недостающего
DI-токена и у каждого потребителя, который её объявил. Текст ошибки для
DI-токенов без подсказок SHALL NOT меняться.

#### Scenario: Все дыры видны сразу

- **WHEN** в графе не хватает провайдеров для трёх DI-токенов
- **THEN** сборка падает одной ошибкой, перечисляющей все три с их
  потребителями, и ни один конструктор не выполняется

#### Scenario: Подсказка про семейство сохраняется

- **WHEN** недостающий DI-токен выглядит как член семейства, созданный
  `makeToken` вручную
- **THEN** сообщение по-прежнему объясняет, что членов создаёт вызов
  семейства

#### Scenario: Подсказка объявления печатается рядом с нехваткой

- **WHEN** недостающий DI-токен объявлен с подсказкой, а его потребитель —
  со своей
- **THEN** ошибка несёт обе, по строке на DI-токен
