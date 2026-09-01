# container-module-attribution Specification

## Purpose
TBD - created by archiving change container-fixes. Update Purpose after archive.
## Requirements
### Requirement: Functional module providers inherit module attribution

Провайдеры из функциональной фабрики модуля (`ProvidersFactory`) SHALL получать
в метаданных узла графа ту же метку модуля (`metadata.module`), что и
провайдеры, объявленные массивом в том же модуле. Флага экспортированности у
узла графа SHALL NOT существовать: поле `metadata.exported` удалено вместе с
`Module.exports`.

#### Scenario: Sync provider factory attributes to module

- **WHEN** модуль `{ name: 'FeatureModule', providers: () => [SomeService] }`
  зарегистрирован и контейнер собран
- **THEN** узел графа для `SomeService` имеет `metadata.module === 'FeatureModule'`

#### Scenario: Async provider factory attributes to module

- **WHEN** модуль с `providers: async () => [SomeService]` собран
- **THEN** узел графа для `SomeService` имеет `metadata.module === 'FeatureModule'`

#### Scenario: Node metadata carries no exported flag

- **WHEN** контейнер с модулем собран и вызван `toJSON()`
- **THEN** метаданные узла содержат `module`, но поля `exported` в них нет
