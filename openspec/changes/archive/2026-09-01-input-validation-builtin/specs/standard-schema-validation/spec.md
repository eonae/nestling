## MODIFIED Requirements

### Requirement: Validation logic has a single implementation

Валидация SHALL выполняться единственной функцией `validateSync`
(`@common/misc`; `@nestling/pipeline` SHALL реэкспортировать её и
сопутствующие `SchemaValidationError`, `SchemaIssue`, `normalizeIssues`,
`assertStandardSchema`, `AsyncSchemaNotSupportedError`,
`NotAStandardSchemaError` из прежнего места, чтобы публичный API не менялся).
Через неё проходят `parsePayload`, `parseMetadata`, проверка входа
endpoint'а рантаймом пайплайна (capability `endpoint-input-validation`),
поэлементная валидация элементов потока и валидация полей секций конфига.
Прямые вызовы `schema.parse(...)` и дак-тайп-интерфейсы вида
`{ parse(data: unknown): T }` SHALL быть удалены из ядра и транспортов.
Транспорты SHALL NOT содержать собственных веток валидации payload: они
собирают значение, а проверяет его рантайм.

Дом функции — `@common/misc`, а не `@nestling/pipeline`, потому что
конфигурация читается и валидируется до существования запроса: зависимость
`@nestling/config → @nestling/pipeline` инвертировала бы порядок фаз
жизненного цикла.

#### Scenario: Одинаковая ошибка на разных путях

- **WHEN** одна и та же невалидная запись приходит endpoint'у с
  пайплайном и endpoint'у без пайплайна
- **THEN** в обоих случаях ответ несёт `VALIDATION_FAILED` с одинаковой
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
