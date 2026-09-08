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
конструктор проставляет токен своего пакета. Чтобы слой пайплайна не
зависел от слоя транспорта внутри `@nestling/app`, ядро SHALL
типизировать поле как токен неуточнённого типа, а слой транспорта SHALL
уточнять его как токен `ITransport`. Строковое имя транспорта SHALL
выводиться из идентификатора токена и SHALL продолжать передаваться в
`Raw.transport` и `EndpointMeta.transport` — пайплайн-слои, читающие имя
транспорта, SHALL NOT ломаться.

Транспортный словарь SHALL быть допустим только в декларации. Хендлер и
пайплайн SHALL получать поля транспорта только через стартовый контекст и
только там, где адрес объявлен транспортом: анонимная форма
`httpEndpoint` SHALL давать хендлеру `meta.http`, а `implement` и форма с
`operation:` SHALL NOT. Зависимость от транспорта SHALL быть видна в
сигнатуре хендлера и SHALL проверяться компилятором.

#### Scenario: HTTP-декларация создаётся конструктором

- **WHEN** объявлено `httpEndpoint({ method: 'POST', path: '/api/users', input: CreateUserInput, output: UserOutput, pipeline: basePipeline, handler })`
- **THEN** результат — значение с токеном HTTP-транспорта в `transport` и
  `pattern === 'POST /api/users'`, готовое к объявлению в `endpoints:` модуля

#### Scenario: CLI-декларация создаётся своим конструктором

- **WHEN** объявлено `cliEndpoint({ command: 'process-stdin', input, output, pipeline, handler })`
- **THEN** результат — значение с токеном CLI-транспорта в `transport` и
  `pattern === 'process-stdin'`

#### Scenario: Имя транспорта доходит до слоёв

- **WHEN** слой пайплайна читает `meta.transport` при обработке
  HTTP-запроса
- **THEN** он получает строку `'http'`, как и раньше

#### Scenario: Хендлер операции остаётся без полей транспорта

- **WHEN** класс объявлен `implements Handler<typeof CreateUser>` и
  передан в `implement(CreateUser, { handler })`
- **THEN** его `meta` не содержит `http`, и класс переносим между
  транспортами

#### Scenario: Декларация — обычное значение

- **WHEN** декларация присвоена переменной, экспортирована, помещена в
  массив и передана в другой модуль
- **THEN** никаких побочных эффектов не происходит: значение нигде не
  саморегистрируется и вне `endpoints:` на приложение не влияет

## ADDED Requirements

### Requirement: `Handler<C>` и `HandlerMeta` выводятся из операции

`@nestling/app` SHALL экспортировать `HandlerMeta` — тип второго
параметра хендлера: обязательное поле `signal: AbortSignal` и поля
контекста, накопленные `.pre`-юнитами.

`@nestling/app` SHALL экспортировать интерфейс `Handler<C>`, где `C` —
тип операции. Типы входа, результата и множества отказов SHALL браться с
операции и SHALL NOT переписываться руками. `implements Handler<typeof
Op>` SHALL давать раннюю ошибку в классе; окончательная сверка со схемами
SHALL оставаться в слоте `handler:` декларации.

Имя `Handler` SHALL быть одним и тем же для интерфейса и для декоратора
роли: `@nestling/app` SHALL экспортировать под этим именем и интерфейс, и
декоратор из `@nestling/container`, чтобы класс-хендлер объявлялся одним
импортом.

#### Scenario: Один импорт даёт декоратор и интерфейс

- **WHEN** файл объявляет `@Handler([UserService]) class CreateUserHandler
  implements Handler<typeof CreateUser>` и импортирует `Handler` из
  `@nestling/app`
- **THEN** код компилируется

#### Scenario: Расхождение с операцией ловится в классе

- **WHEN** класс с `implements Handler<typeof CreateUser>` возвращает
  значение другой формы
- **THEN** это ошибка компиляции в объявлении класса, до декларации
