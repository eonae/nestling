## ADDED Requirements

### Requirement: Пакет `@nestlingjs/logging.pino` — сателлит логирования

Репозиторий SHALL содержать пакет `@nestlingjs/logging.pino` в каталоге
`packages/nestling.logging.pino`. Барель пакета SHALL экспортировать
функцию `pinoLogger` и тип `PinoLoggerOptions`, и больше ничего.

Зависимость у пакета SHALL быть одна — `@nestlingjs/logging`. `pino` SHALL
стоять в `peerDependencies`: версию библиотеки выбирает приложение, и
второй копии pino в дереве быть не должно. `@nestlingjs/app` пакет SHALL
NOT импортировать: адаптеру нужен интерфейс, а не композиционный корень.

#### Scenario: Состав зависимостей

- **WHEN** прочитан манифест `@nestlingjs/logging.pino`
- **THEN** в `dependencies` стоит `@nestlingjs/logging` и ничего больше, в
  `peerDependencies` — `pino`, а `@nestlingjs/app` не назван нигде

#### Scenario: Логгер уходит в опцию корня

- **WHEN** приложение собрано как
  `makeApp({ …, logging: { logger: pinoLogger() } })`
- **THEN** записи ядра, сборки и сервисов уходят через pino, а поля
  корреляции им ставит декоратор корня

### Requirement: `pinoLogger(options)` отдаёт `Logger` поверх pino

`pinoLogger(options?)` SHALL возвращать `Logger`: четыре уровня, три формы
вызова у каждого и `child(bindings)`. Внутри SHALL работать настоящий
экземпляр pino, поэтому redaction, сериализаторы и семплирование SHALL
быть доступны через опции библиотеки.

Опции SHALL быть `{ level?, format?, pino? }` с умолчаниями `info` и
`text`. Поле `pino` SHALL принимать остальные опции библиотеки.

Формы вызова SHALL ложиться на pino так: `(message, fields?)` — поля
объектом и сообщение строкой; `(error, fields?)` — сообщение из
`error.message`, сама ошибка ключом `err`; `(fields)` — объект без
сообщения. Поля второго аргумента SHALL NOT перекрывать `err`.

`child(bindings)` SHALL возвращать логгер поверх `pino.child(bindings)`.
Привязки SHALL идти в строке раньше полей вызова, поля вызова SHALL
перекрывать привязки.

#### Scenario: Форма с ошибкой

- **WHEN** вызван `logger.error(new Error('connection lost'), { host: 'db' })`
- **THEN** сообщением записи становится `connection lost`, поле `host`
  остаётся, а ошибка уходит ключом `err`

#### Scenario: Запись без сообщения

- **WHEN** вызван `logger.info({ served: 12 })`
- **THEN** в строке нет ключа сообщения, а поле `served` есть

#### Scenario: Привязки дочернего логгера

- **WHEN** создан `pinoLogger().child({ scope: 'users' })` и вызван
  `logger.info('created', { id: 7 })`
- **THEN** в записи есть и `scope`, и `id`

#### Scenario: Опции библиотеки доходят до неё

- **WHEN** создан `pinoLogger({ pino: { redact: ['password'] } })` и
  записано поле `password`
- **THEN** в строке вместо значения стоит метка redaction

### Requirement: Записи уходят в `stderr` своим синхронным писателем

Пакет SHALL создавать pino с собственным потоком назначения, который
пишет строку через `process.stderr.write`. Запись SHALL доходить до
дескриптора в том же тике: аварийный выход процесса SHALL NOT терять
последние строки.

`pino.transport`, `pino-pretty`, `pino.destination` и любой второй поток
или процесс вывода SHALL NOT использоваться. Воркер-поток не собирается
одним бандлом и добавляет асинхронную границу перед выводом.

Строку, которую писатель не разобрал как JSON, он SHALL отдать в `stderr`
как есть: потеря записи хуже строки не того формата.

#### Scenario: `stdout` свободен

- **WHEN** команда CLI печатает результат в `stdout`, а хендлер пишет
  логгером
- **THEN** в `stdout` только результат команды, а записи — в `stderr`

#### Scenario: Вывод виден перехвату

- **WHEN** тест подменяет `process.stderr.write` и вызывает
  `pinoLogger().info('ready')`
- **THEN** перехват получает строку записи

### Requirement: Формат `text` совпадает со штатным логгером

В формате `text` пакет SHALL печатать строку функцией `formatLine` из
`@nestlingjs/logging`. Своей реализации формата у сателлита SHALL NOT
быть.

При одинаковом времени записи вывод `pinoLogger({ format: 'text' })` и
`makeConsoleLogger({ format: 'text' })` на одной последовательности
вызовов SHALL совпадать посимвольно, включая порядок полей, запись
ошибки со стеком и причиной.

#### Scenario: Две реализации дают одну строку

- **WHEN** через оба логгера пройдена одна последовательность вызовов —
  сообщение с полями, ошибка с причиной, запись без сообщения и запись
  дочернего логгера
- **THEN** строки совпадают, кроме времени

#### Scenario: Ошибка в тексте

- **WHEN** записана ошибка с `cause`
- **THEN** строка несёт `err=<name>: <message>`, стек следующими строками
  и причину после стека — как у штатного логгера

### Requirement: Формат `json` пишет сам pino

В формате `json` строку SHALL формировать pino. Набор ключей SHALL
совпадать со штатным логгером: `time` — время ISO строкой, `level` —
метка уровня строкой, `msg` — сообщение, `err` — объект
`{ name, message, stack, cause? }`, остальные ключи — привязки и поля
вызова.

Ключей `pid` и `hostname` в записи SHALL NOT быть: статические поля
процесса добавляет `logger.child({ … })` при создании.

Порядок ключей SHALL NOT совпадать со штатным логгером и SHALL NOT быть
требованием: `json` читает парсер, а строку формирует pino.

#### Scenario: Запись без полей процесса

- **WHEN** создан `pinoLogger({ format: 'json' })` и вызван
  `logger.info('ready')`
- **THEN** в разобранной записи есть `time`, `level` и `msg` и нет `pid`
  и `hostname`

#### Scenario: Уровень строкой

- **WHEN** разобрана запись уровня `warn`
- **THEN** значение `level` — строка `warn`, а не число

#### Scenario: Ошибка объектом

- **WHEN** записана ошибка с `cause`
- **THEN** `err` несёт `name`, `message`, `stack` и `cause` — те же ключи,
  что пишет штатный логгер

### Requirement: Порог принимает уровни pino и отображает их на четыре

Опция `level` SHALL принимать `debug`, `info`, `warn`, `error`, `silent`,
а вдобавок уровни pino `trace` и `fatal`. `trace` SHALL отображаться на
`debug`, `fatal` — на `error`: в интерфейсе `Logger` четыре уровня, и
писать пятым нечем.

`silent` SHALL отсекать все четыре уровня.

#### Scenario: Уровень pino на входе

- **WHEN** создан `pinoLogger({ level: 'trace' })`
- **THEN** записи уровня `debug` проходят

#### Scenario: Верхний уровень pino

- **WHEN** создан `pinoLogger({ level: 'fatal' })`
- **THEN** записи уровня `error` проходят, а `warn` — нет

#### Scenario: Молчащий логгер

- **WHEN** создан `pinoLogger({ level: 'silent' })`
- **THEN** ни один из четырёх уровней ничего не пишет

### Requirement: Ключи, которыми держится формат, заняты адаптером

Опции pino `level`, `timestamp`, `formatters`, `base`, `messageKey`,
`errorKey`, `transport` и вложенный `serializers.err` SHALL задаваться
адаптером. Тип поля `pino` SHALL снимать эти ключи, кроме вложенного, а
`pinoLogger` SHALL проверять их ещё раз при создании логгера.

Занятый ключ в поле `pino` SHALL давать `TypeError` с именем ключа и
заменой — опцией адаптера или причиной, по которой ключ занят. Молча
перетирать переданное значение SHALL NOT допускаться.

Остальные опции pino SHALL доходить до библиотеки как есть, включая
сериализаторы других ключей.

#### Scenario: Занятый ключ верхнего уровня

- **WHEN** создан `pinoLogger({ pino: { timestamp: false } })`
- **THEN** вызов даёт `TypeError`, называющий `timestamp` и то, что время
  ISO — часть формата записи

#### Scenario: Занятый вложенный ключ

- **WHEN** создан `pinoLogger({ pino: { serializers: { err: myErr } } })`
- **THEN** вызов даёт `TypeError`, называющий `serializers.err`

#### Scenario: Сериализатор другого ключа

- **WHEN** создан `pinoLogger({ pino: { serializers: { user: shortUser } } })`
- **THEN** логгер создаётся, и поле `user` сериализуется переданной
  функцией
