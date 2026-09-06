# lifecycle-metadata-idempotency Specification

## Purpose
TBD - created by archiving change container-fixes. Update Purpose after archive.
## Requirements

### Requirement: Метаданные `@OnStart` собираются один раз на метод

Декоратор `@OnStart` SHALL записывать имя декорированного метода в
метаданные класса ровно один раз, независимо от количества созданных
инстансов. `getLifecycleHooks(instance)` SHALL возвращать хуки `onStart`,
каждый ровно один раз; других списков хуков SHALL NOT существовать.

`BuiltContainer.start(signal)` SHALL вызывать каждый `@OnStart`-хук ровно
один раз на инстанс за один запуск приложения; повторный вызов `start()`
SHALL NOT приводить к повторному выполнению хуков.

#### Scenario: Несколько инстансов не дублируют start-хуки

- **WHEN** класс с одним методом `@OnStart()` инстанцируется 3 раза
- **THEN** `getLifecycleHooks(instance).onStart` для любого инстанса имеет
  длину 1

#### Scenario: Start-хук выполняется один раз на инстанс

- **WHEN** контейнер с сервисом, у которого один `@OnStart`-метод,
  стартует
- **THEN** метод вызывается ровно один раз

#### Scenario: Повторный `start()` идемпотентен

- **WHEN** `container.start(signal)` вызван дважды
- **THEN** `@OnStart`-хуки выполнены один раз

#### Scenario: Класс с единственным видом хуков

- **WHEN** класс объявляет `@OnStart`
- **THEN** `getLifecycleHooks(instance)` возвращает его в списке `onStart`,
  и других списков не содержит
