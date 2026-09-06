## MODIFIED Requirements

### Requirement: Detached — поверхность для аудита, а не тихая дыра

`App` SHALL писать на старте по одной записи уровня `info` на каждый
detached-endpoint через логгер ядра, с полями `pattern`, `transport` и
`reason`. Записи SHALL появляться только когда список непуст.

`CheckReport` SHALL нести причину значением: endpoint отчёта SHALL иметь поле
`detached?: string`. Тест матрицы топологий SHALL иметь возможность сравнивать
состав detached-endpoint'ов, не разбирая записи логгера.

#### Scenario: Список пишется на старте

- **WHEN** приложение с двумя detached-endpoint'ами начинает принимать запросы с подменой
  `RootLogger$`
- **THEN** среди записей есть две `info` с паттернами обоих endpoint'ов и их
  причинами

#### Scenario: Ни одного detached-endpoint'а — ни одной записи

- **WHEN** приложение не имеет detached-endpoint'ов
- **THEN** записей о detached-endpoint'ах нет

#### Scenario: Отчёт несёт причину значением

- **WHEN** `await makeApp({ … }).check()`
- **THEN** endpoint отчёта, помеченный в декларации, несёт `detached` с той же
  строкой-причиной
