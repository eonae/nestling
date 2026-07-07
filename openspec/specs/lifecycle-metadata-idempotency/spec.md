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

