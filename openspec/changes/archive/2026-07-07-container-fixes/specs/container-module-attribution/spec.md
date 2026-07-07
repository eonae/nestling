# container-module-attribution

## ADDED Requirements

### Requirement: Functional module providers inherit module attribution

Провайдеры из функциональной фабрики модуля (`ProvidersFactory`) SHALL получать
в метаданных узла графа ту же метку модуля (`metadata.module`), что и
провайдеры, объявленные массивом в том же модуле. Токены, отсутствующие в
`exports` модуля, SHALL иметь `metadata.exported === false`;
присутствующие — `true`.

#### Scenario: Sync provider factory attributes to module

- **WHEN** модуль `{ name: 'FeatureModule', providers: () => [SomeService] }`
  зарегистрирован и контейнер собран
- **THEN** узел графа для `SomeService` имеет `metadata.module === 'FeatureModule'`

#### Scenario: Async provider factory attributes to module

- **WHEN** модуль с `providers: async () => [SomeService]` собран
- **THEN** узел графа для `SomeService` имеет `metadata.module === 'FeatureModule'`

#### Scenario: Exported flag reflects module exports

- **WHEN** модуль с функциональной фабрикой экспортирует один из своих токенов
  (`exports: [ExportedToken]`), а другой — нет
- **THEN** узел `ExportedToken` имеет `metadata.exported === true`, а
  неэкспортированный узел — `metadata.exported === false`
