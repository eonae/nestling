## RENAMED Requirements

- FROM: `### Requirement: Форма с `operation:` HTTP-декларации`
- TO: `### Requirement: Реализация операции по HTTP — обычная декларация`

## MODIFIED Requirements

### Requirement: Декларация endpoint'а — значение, созданное конструктором своего транспорта

Декларация endpoint'а SHALL быть значением. Каждый транспорт SHALL
экспортировать свой конструктор деклараций, принимающий типизированный
словарь этого транспорта: `@nestlingjs/transport.http` SHALL экспортировать
`httpEndpoint({ method, path, … })`, `@nestlingjs/transport.cli` SHALL
экспортировать `cliEndpoint({ command, … })`. Конструктор SHALL возвращать
`EndpointDefinition`, пригодный и для объявления в модуле, и (если у
декларации нет неразрешённых зависимостей) для прямой передачи в
`makeDispatch` на standalone-пути.

Поле `transport` декларации SHALL нести **токен** транспорта, а не строку:
конструктор проставляет токен своего пакета. Чтобы слой пайплайна не
зависел от слоя транспорта внутри `@nestlingjs/app`, ядро SHALL
типизировать поле как токен неуточнённого типа, а слой транспорта SHALL
уточнять его как токен `ITransport`. Строковое имя транспорта SHALL
выводиться из идентификатора токена и SHALL продолжать передаваться в
`Raw.transport` и `EndpointMeta.transport` — пайплайн-слои, читающие имя
транспорта, SHALL NOT ломаться.

Реализация операции SHALL объявляться **отдельным конструктором**, а не
ключом в словаре анонимной формы: `@nestlingjs/transport.http` SHALL
экспортировать `httpEndpoint.implement(Operation, { pipeline?, handler,
detached?, on? })`. Операция SHALL идти первым аргументом, как у
`implement(Operation, { … })`. Словарь `httpEndpoint` SHALL NOT принимать
ключ `operation`, а словарь `httpEndpoint.implement` SHALL NOT принимать
поля, которыми владеет операция (`method`, `path`, `input`, `output`,
`errors`, `bind`, `rawBody`, `sse`, `doc`).

У каждого из двух конструкторов SHALL быть ровно две перегрузки — по
одной на форму хендлера. Это граница, за которой TypeScript печатает
только последнюю перегрузку: диагностика неверной декларации SHALL
называть форму, в которой ошиблись, а не ту, что стоит последней.

Транспортный словарь SHALL быть допустим только в декларации. Хендлер и
пайплайн SHALL получать поля транспорта только через стартовый контекст и
только там, где адрес объявлен транспортом: `httpEndpoint` SHALL давать
хендлеру `meta.http`, а `implement` и `httpEndpoint.implement` SHALL NOT.
Зависимость от транспорта SHALL быть видна в сигнатуре хендлера и SHALL
проверяться компилятором.

#### Scenario: HTTP-декларация создаётся конструктором

- **WHEN** объявлено `httpEndpoint({ method: 'POST', path: '/api/users', input: CreateUserInput, output: UserOutput, pipeline: basePipeline, handler })`
- **THEN** результат — значение с токеном HTTP-транспорта в `transport` и
  `pattern === 'POST /api/users'`, готовое к объявлению в `endpoints:` модуля

#### Scenario: Реализация операции создаётся вторым конструктором

- **WHEN** объявлено `httpEndpoint.implement(CreateUser, { pipeline: basePipeline, handler })`,
  где операция `CreateUser` несёт `http: 'POST /users'`
- **THEN** результат — обычная HTTP-декларация: адрес, схемы, `errors` и
  `doc` взяты с операции, `pattern === 'POST /users'`

#### Scenario: Ключа `operation` в словаре нет

- **WHEN** объявлено `httpEndpoint({ operation: CreateUser, handler })`
- **THEN** это ошибка компиляции: словарь такого ключа не знает

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

### Requirement: Реализация операции по HTTP — обычная декларация

`httpEndpoint.implement` SHALL отвергать операцию без секции `http:` в
момент создания декларации. Текст ошибки SHALL называть операцию и SHALL
предлагать две починки: объявить `http:` на операции либо реализовать её
на шине через `implement`.

Созданная декларация SHALL участвовать в discovery, политиках и
визуализации наравне с декларацией, у которой свой адрес. Обе формы
хендлера, слот `pipeline` и признак `detached` SHALL работать так же:
второй конструктор — форма записи, а не новый примитив.

#### Scenario: Операция без `http:`

- **WHEN** в `httpEndpoint.implement` передана операция без секции `http`
- **THEN** вызов бросает ошибку в момент создания декларации, называя
  операцию

#### Scenario: Декларация ведёт себя как обычная

- **WHEN** такая декларация объявлена в `endpoints:` модуля
- **THEN** discovery, `policies`, визуализация и pipeline работают так же,
  как для декларации со своим адресом

## REMOVED Requirements

### Requirement: Форма с `operation:` сверяет отказы пайплайна с операцией

**Reason**: Требование описывало слот `pipeline` словаря
`httpEndpoint({ operation, … })`, а такого словаря больше нет.

**Migration**: Правило целиком живёт в capability `layer-declared-fails`,
требование «Форма с операцией требует вхождения отказов пайплайна в
`errors:` операции». Там оно записано через `httpEndpoint.implement` и
покрывает заодно реализацию на шине через `implement`.
