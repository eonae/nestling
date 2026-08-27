# standard-schema-validation

## MODIFIED Requirements

### Requirement: Validation logic has a single implementation

Валидация SHALL выполняться единственной функцией `validateSync`
(`@common/misc`; `@nestling/pipeline` SHALL реэкспортировать её и
сопутствующие `SchemaValidationError`, `SchemaIssue`, `normalizeIssues`,
`assertStandardSchema`, `AsyncSchemaNotSupportedError`,
`NotAStandardSchemaError` из прежнего места, чтобы публичный API не менялся).
Через неё проходят `parsePayload`, `parseMetadata`, pipeline-юнит `validate()`,
поэлементная валидация элементов потока в транспорте, fallback-ветки
транспортов без pipeline и валидация полей секций конфига.
Прямые вызовы `schema.parse(...)` и дак-тайп-интерфейсы вида
`{ parse(data: unknown): T }` SHALL быть удалены из ядра и транспортов.

Дом функции — `@common/misc`, а не `@nestling/pipeline`, потому что
конфигурация читается и валидируется до существования запроса: зависимость
`@nestling/config → @nestling/pipeline` инвертировала бы порядок фаз
жизненного цикла.

#### Scenario: Одинаковая ошибка на разных путях

- **WHEN** одна и та же невалидная запись проходит валидацию через юнит
  `validate()` и через fallback-ветку транспорта без pipeline
- **THEN** в обоих случаях получается `SchemaValidationError` с одинаковой
  формой `issues`

#### Scenario: Поэлементная валидация потока

- **WHEN** в NDJSON-поток приходит элемент, не проходящий схему элемента
- **THEN** бросается `SchemaValidationError` с теми же нормализованными
  `issues`, что и при валидации обычного payload'а

#### Scenario: Прежние импорты продолжают работать

- **WHEN** код импортирует `validateSync` или `SchemaValidationError` из
  `@nestling/pipeline`
- **THEN** импорт разрешается реэкспортом, поведение идентично прямому импорту
  из `@common/misc`

#### Scenario: Конфиг валидирует той же функцией

- **WHEN** поле секции конфига не проходит свою схему
- **THEN** issues имеют ту же нормализованную форму, что и у отказа валидации
  запроса

### Requirement: Core does not depend on a validator

Пакеты ядра (`@common/misc`, `@nestling/container`, `@nestling/config`,
`@nestling/pipeline`, `@nestling/app`, `@nestling/transport`,
`@nestling/transport.http`, `@nestling/transport.cli`) SHALL NOT объявлять
валидатор схем в `dependencies` или `peerDependencies` и SHALL NOT
импортировать его в рантайме. Единственной схемной зависимостью SHALL быть
types-only `@standard-schema/spec`, а тип `StandardSchemaV1` SHALL
реэкспортироваться из `@common/misc` — чтобы потребителю не требовалось ставить
пакет спеки.

#### Scenario: Установка без валидатора

- **WHEN** приложение ставит пакеты ядра и не ставит ни один валидатор
- **THEN** установка проходит без предупреждений о неудовлетворённых peer
  dependencies, а код без схем работает

#### Scenario: Нет рантайм-импортов валидатора

- **WHEN** исходники пакетов ядра (кроме `*.spec.ts`) просматриваются на
  импорты `zod`
- **THEN** ни одного импорта не находится — ни type-only, ни рантайм-

#### Scenario: Тип доступен без установки спеки

- **WHEN** потребитель объявляет собственную функцию с параметром типа
  `Schema`, импортированного из `@common/misc`
- **THEN** код компилируется без прямой зависимости на
  `@standard-schema/spec`

#### Scenario: Конфиг принимает схему любого вендора

- **WHEN** секция объявлена со схемами разных валидаторов в разных полях
- **THEN** `@nestling/config` работает с ними одинаково и не объявляет ни один
  валидатор в зависимостях
</content>
