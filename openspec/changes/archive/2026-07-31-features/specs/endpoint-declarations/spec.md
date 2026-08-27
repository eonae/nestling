## MODIFIED Requirements

### Requirement: Декларация endpoint'а — значение, созданное конструктором своего транспорта

Декларация endpoint'а SHALL быть значением. Каждый транспорт SHALL
экспортировать свой конструктор деклараций, принимающий типизированный
словарь этого транспорта: `@nestling/transport.http` SHALL экспортировать
`httpEndpoint({ method, path, … })`, `@nestling/transport.cli` SHALL
экспортировать `cliEndpoint({ command, … })`. Конструктор SHALL возвращать
`EndpointDefinition`, пригодный и для объявления в модуле, и (если у
декларации нет неразрешённых зависимостей) для прямой передачи в
`makeDispatch` на standalone-пути.

Поле `transport` декларации SHALL нести **токен** транспорта, а не строку:
конструктор проставляет токен своего пакета. Чтобы `@nestling/pipeline` не
зависел от `@nestling/transport`, ядро SHALL типизировать поле как токен
неуточнённого типа, а `@nestling/transport` SHALL уточнять его как токен
`ITransport`. Строковое имя транспорта SHALL выводиться из идентификатора
токена и SHALL продолжать ехать в `Raw.transport` и `EndpointMeta.transport`
— пайплайн-слои, читающие имя транспорта, SHALL NOT ломаться.

Транспортный словарь SHALL быть легален только в декларации: пайплайн и
хендлер SHALL оставаться транспорт-слепыми и SHALL NOT получать полей
транспорта.

#### Scenario: HTTP-декларация создаётся конструктором

- **WHEN** объявлено `httpEndpoint({ method: 'POST', path: '/api/users', input: CreateUserInput, output: UserOutput, pipeline: basePipeline, handle })`
- **THEN** результат — значение с токеном HTTP-транспорта в `transport` и
  `pattern === 'POST /api/users'`, готовое к объявлению в `endpoints:` модуля

#### Scenario: CLI-декларация создаётся своим конструктором

- **WHEN** объявлено `cliEndpoint({ command: 'process-stdin', input, output, pipeline, handle })`
- **THEN** результат — значение с токеном CLI-транспорта в `transport` и
  `pattern === 'process-stdin'`

#### Scenario: Имя транспорта доезжает до слоёв

- **WHEN** слой пайплайна читает `meta.transport` при обработке
  HTTP-запроса
- **THEN** он получает строку `'http'`, как и раньше

#### Scenario: Декларация — обычное значение

- **WHEN** декларация присвоена переменной, экспортирована, помещена в
  массив и передана в другой модуль
- **THEN** никаких побочных эффектов не происходит: значение нигде не
  саморегистрируется и вне `endpoints:` на приложение не влияет
