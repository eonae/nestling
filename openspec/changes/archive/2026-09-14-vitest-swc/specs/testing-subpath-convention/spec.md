## MODIFIED Requirements

### Requirement: Репозиторий включает условие в тест-раннере

Конфигурация тестов репозитория SHALL включать условие `"testing"` для
резолва (`resolve.conditions` в vitest), SHALL корректно резолвить
subpath'ы workspace-пакетов на исходники и SHALL поддерживать `await using`
в тестах.

#### Scenario: Subpath резолвится на исходники

- **WHEN** тест импортирует `@nestlingjs/app/testing`
- **THEN** резолв ведёт на исходники пакета, как и для главного экспорта

#### Scenario: `await using` компилируется и работает

- **WHEN** тест написан как `await using testApp = await buildTest({ … })`
- **THEN** он компилируется без ошибок типов и вызывает
  `Symbol.asyncDispose` по выходу из блока

### Requirement: Условие названо в документации потребителя

README пакета, тестовая поверхность которого объявлена subpath'ом под
условием `"testing"`, SHALL называть это условие и способ его включить.
Глава гайда про тесты SHALL называть его же.

Без этого установивший пакет получает `ERR_PACKAGE_PATH_NOT_EXPORTED` —
сообщение, которое не подсказывает ни причины, ни решения.

#### Scenario: Потребитель включает условие

- **WHEN** читатель README `@nestlingjs/testing` заводит тесты в своём
  проекте
- **THEN** README называет условие `"testing"` и способ его включить —
  `resolve.conditions` для vitest, `--conditions=testing` для Node и
  `customExportConditions` для jest

#### Scenario: Глава гайда про тесты

- **WHEN** читатель дошёл до главы гайда про тесты
- **THEN** глава называет условие `"testing"` и то, что без него импорт
  тестовой поверхности не резолвится
