## REMOVED Requirements

### Requirement: `withRequestLogging` принимает `Logger` ядра

`withRequestLogging(logger)` SHALL принимать `Logger` из `@nestlingjs/app`
и писать `info` с сообщением о начале обработки и полями `transport` и
`pattern`. Локального интерфейса `Logger` у юнита SHALL NOT существовать.

#### Scenario: Запись о начале обработки

- **WHEN** пайплайн с `.pre(withRequestLogging(spy.logger))` исполняет
  `GET /users`
- **THEN** в `spy.entries` есть `info` с `transport: 'http'` и
  `pattern: 'GET /users'`

**Reason**: `withRequestLogging` удалён вместе с двумя другими
устаревшими pre-юнитами (`pipeline-stale-units`, roadmap #81) —
инвентаризация импортов не нашла ни одного вызывающего кода вне
собственной спеки юнита.

**Migration**: не требуется — юнит нигде не использовался за пределами
своей спеки. Логирование начала обработки запроса пишет вызывающий код
через канонический `Logger` напрямую, если оно ему нужно.
