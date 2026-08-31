# multi-injection Specification (delta)

## MODIFIED Requirements

### Requirement: Aggregate belongs to no module and consumes contributions as an outside consumer

Узел-агрегат SHALL иметь `metadata.module === undefined`. Его рёбра к членам
семейства SHALL строиться без каких-либо ограничений со стороны модулей:
вклад объявляется провайдером члена в `providers` модуля, и другого
объявления SHALL NOT требоваться. Ребро `потребитель → агрегат` SHALL
допускаться свободно.

#### Scenario: Aggregate node has no module attribution

- **WHEN** контейнер с агрегатом собран
- **THEN** узел `"HealthCheck:{all}"` имеет `metadata.module === undefined`

#### Scenario: Contribution from another module needs no declaration

- **WHEN** модуль `db` регистрирует вклад `classProvider(IHealthCheck('db'), DbHealthCheck)`,
  а потребитель из другого модуля объявляет `IHealthCheck.all`
- **THEN** `build()` завершается успешно и вклад попадает в массив агрегата
