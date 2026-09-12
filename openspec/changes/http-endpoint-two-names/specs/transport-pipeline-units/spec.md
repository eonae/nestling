## MODIFIED Requirements

### Requirement: Транспорт экспортирует тип своего стартового контекста

Транспорт SHALL экспортировать тип полей, которые он кладёт в контекст до
первого `.pre`-юнита. У HTTP это `HttpStartContext`: поле `http` с
запросом, а также `rawBody` и `lastEventId`, которые добавляют пометки
декларации `rawBody: true` и `output: events(...)`.

Слот `pipeline` декларации `httpEndpoint` SHALL принимать
`Pipeline<HttpStartContext, …>` и SHALL отвергать пайплайн, требующий
полей, которых стартовый контекст этой декларации не даёт.
`httpEndpoint.implement` SHALL принимать такой пайплайн наравне с
`httpEndpoint`: хендлер там остаётся без `http`, потому что его `meta` не
пересекается с запросом.

#### Scenario: Юнит читает стартовый контекст

- **WHEN** пайплайн объявлен `makePipeline<HttpStartContext>().pre(withClientIp())`
  и передан в `httpEndpoint`
- **THEN** код компилируется, и юнит читает `ctx.input.http`

#### Scenario: Пайплайн требует поля, которого декларация не даёт

- **WHEN** в слот `pipeline` передан пайплайн, требующий `rawBody`, а
  декларация пометки `rawBody: true` не несёт
- **THEN** это ошибка компиляции с литералом `__error`, `missing`, `hint`
