# lifecycle-metadata-idempotency Specification

## Purpose
TBD - created by archiving change container-fixes. Update Purpose after archive.
## Requirements
### Requirement: Lifecycle hook metadata is collected once per class method

Метаданные, собираемые декораторами `@OnInit` и `@OnDestroy`, SHALL содержать
имя каждого декорированного метода ровно один раз, независимо от количества
созданных инстансов класса. `getLifecycleHooks(instance)` SHALL возвращать
каждый хук ровно один раз.

#### Scenario: Multiple instances do not duplicate init hooks

- **WHEN** класс с одним методом `@OnInit()` инстанцируется 3 раза
- **THEN** `getLifecycleHooks(instance).onInit` для любого инстанса имеет длину 1

#### Scenario: Multiple instances do not duplicate destroy hooks

- **WHEN** класс с одним методом `@OnDestroy()` инстанцируется 3 раза
- **THEN** `getLifecycleHooks(instance).onDestroy` для любого инстанса имеет длину 1

#### Scenario: Init hook runs once per instance

- **WHEN** контейнер с сервисом, у которого один `@OnInit`-метод, инициализируется
  через `init()`
- **THEN** метод инициализации вызывается ровно один раз (не по числу
  предыдущих сборок контейнера в процессе)

### Requirement: Метаданные `@OnStart` собираются один раз на метод

Декоратор `@OnStart` SHALL записывать имя декорированного метода в
метаданные класса ровно один раз, независимо от количества созданных
инстансов. `getLifecycleHooks(instance)` SHALL возвращать хуки `onStart`
наравне с `onInit` и `onDestroy`, каждый ровно один раз.

`BuiltContainer.start()` SHALL вызывать каждый `@OnStart`-хук ровно один раз
на инстанс за один запуск приложения; повторный вызов `start()` SHALL NOT
приводить к повторному выполнению хуков.

#### Scenario: Несколько инстансов не дублируют start-хуки

- **WHEN** класс с одним методом `@OnStart()` инстанцируется 3 раза
- **THEN** `getLifecycleHooks(instance).onStart` для любого инстанса имеет
  длину 1

#### Scenario: Start-хук выполняется один раз на инстанс

- **WHEN** контейнер с сервисом, у которого один `@OnStart`-метод,
  стартует
- **THEN** метод вызывается ровно один раз

#### Scenario: Повторный `start()` идемпотентен

- **WHEN** `container.start()` вызван дважды
- **THEN** `@OnStart`-хуки выполнены один раз

#### Scenario: Класс с тремя видами хуков

- **WHEN** класс объявляет `@OnInit`, `@OnStart` и `@OnDestroy`
- **THEN** `getLifecycleHooks(instance)` возвращает по одному хуку в каждом
  из трёх списков

