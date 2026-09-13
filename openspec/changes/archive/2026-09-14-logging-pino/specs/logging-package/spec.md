## MODIFIED Requirements

### Requirement: Пакет `@nestlingjs/logging` — интерфейс и штатная реализация

Репозиторий SHALL содержать пакет `@nestlingjs/logging` в каталоге
`packages/nestling.logging`. Пакет SHALL экспортировать типы `Logger`,
`Fields`, `LogLevel` и `LogMethod`, фабрику `makeConsoleLogger(options)` и
формат записи — `formatLine(entry, format)`, `serializeError(err)` и тип
`LogEntry`.

Зависимостей у пакета SHALL NOT быть: ни `dependencies`, ни
`peerDependencies`. Он лежит в основании дерева, и сателлит логирования
SHALL зависеть только от него.

Класс реализации SHALL NOT экспортироваться: наружу идёт фабрика.
DI-токены `RootLogger$` и `Logger$`, секция `nestlingLog` и декоратор
полей SHALL оставаться в `@nestlingjs/app` — им нужны контейнер, конфиг и
ячейка запроса.

#### Scenario: Сателлит зависит от одного пакета

- **WHEN** пакет реализует `Logger` поверх сторонней библиотеки
- **THEN** в его `dependencies` есть `@nestlingjs/logging` и нет
  `@nestlingjs/app`

#### Scenario: Реализация приватна

- **WHEN** код пишет `import { ConsoleLogger } from '@nestlingjs/logging'`
- **THEN** импорт не компилируется: пакет отдаёт `makeConsoleLogger`

#### Scenario: Формат доступен реализации

- **WHEN** сателлит пишет
  `import { formatLine, serializeError } from '@nestlingjs/logging'`
- **THEN** импорт компилируется, и сателлит печатает тем же форматом, не
  переписывая его

## ADDED Requirements

### Requirement: Формат записи существует одним экземпляром

Формат записи SHALL быть реализован один раз и SHALL экспортироваться
функцией `formatLine(entry, format)`. Штатный логгер SHALL печатать через
неё же, а не через свою копию формата.

`LogEntry` SHALL нести время записи строкой ISO, уровень, необязательное
сообщение и поля. Поля SHALL идти в том порядке, в каком они попадают в
строку: привязки, затем поля вызова.

Ошибка SHALL приходить в `formatLine` уже сериализованной. `serializeError(err)`
SHALL возвращать `{ name, message, stack, cause? }` для `Error` — причина
сериализуется рекурсивно — и значение как есть для всего остального.
Так формат SHALL NOT зависеть от того, дожил ли объект ошибки до
писателя: реализация поверх сторонней библиотеки получает запись строкой.

#### Scenario: Штатный логгер печатает общей функцией

- **WHEN** прочитан исходник штатного логгера
- **THEN** строку формирует `formatLine`, а второй реализации формата в
  репозитории нет

#### Scenario: Ошибка сериализована до формата

- **WHEN** в `formatLine` передана запись, где `err` — объект
  `{ name, message, stack, cause }`
- **THEN** в формате `text` строка несёт `err=<name>: <message>`, стек
  следующими строками и причину после стека

#### Scenario: Не-ошибка в ключе `err`

- **WHEN** записано поле `err` со строкой `'boom'`
- **THEN** `serializeError` отдаёт её как есть, а формат печатает её
  значением поля
