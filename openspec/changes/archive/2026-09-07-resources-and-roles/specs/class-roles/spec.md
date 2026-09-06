## ADDED Requirements

### Requirement: Три роли класса объявляются тремя декораторами

`@nestling/container` SHALL экспортировать три декоратора роли и SHALL NOT
экспортировать `@Injectable`:

| Роль | Декоратор | Форма класса | Позиция |
|---|---|---|---|
| компонент | `@Component([deps])` | синхронный конструктор | `providers:` |
| ресурс | `@Resource([deps])` | `static acquire`, метод `release` | `providers:` |
| хендлер | `@Handler([deps])` | конструктор, метод `handle` | слот `handler:`; `providers:` — для юнита пайплайна |

Каждый декоратор SHALL записывать в метаданные класса роль и список
зависимостей. Токеном класса SHALL быть сам класс: формы декоратора с
DI-токеном SHALL NOT существовать.

DI-токеном SHALL годиться и класс с приватным конструктором: экземпляр
ресурса создаёт `static acquire`, поэтому публичного конструктора тип
токена требовать SHALL NOT.

Список зависимостей SHALL быть необязательным: `@Component()` SHALL
означать то же, что `@Component([])`.

#### Scenario: Компонент

- **WHEN** класс объявлен `@Component([Database]) class UserService {}`
- **THEN** он регистрируется в `providers:` под собственным токеном, а
  зависимость приходит в конструктор

#### Scenario: Форма без аргумента

- **WHEN** класс без зависимостей объявлен `@Component()`
- **THEN** это то же, что `@Component([])`

#### Scenario: Декоратора `@Injectable` больше нет

- **WHEN** код импортирует `Injectable` из `@nestling/container`
- **THEN** это ошибка компиляции: такого экспорта не существует

### Requirement: Декоратор роли ограничивает форму класса

Тип декоратора SHALL допускать только класс своей формы:

- `@Handler` SHALL требовать метод `handle`;
- `@Resource` SHALL требовать `static acquire` и метод `release`;
- `@Component` SHALL отвергать класс с методом `handle` или со `static
  acquire`.

Диагностика SHALL иметь форму литерала `__error`, называющего роль и
нужный декоратор, — по правилу capability `pipeline-type-diagnostics`.

#### Scenario: Компонент с методом `handle`

- **WHEN** класс с методом `handle` объявлен `@Component([Database])`
- **THEN** это ошибка компиляции, называющая `@Handler` как нужный
  декоратор

#### Scenario: Ресурс без `release`

- **WHEN** класс со `static acquire`, но без метода `release`, объявлен
  `@Resource([DbConfig])`
- **THEN** это ошибка компиляции

#### Scenario: Хендлер без `handle`

- **WHEN** класс без метода `handle` объявлен `@Handler([UserService])`
- **THEN** это ошибка компиляции

### Requirement: Роль сверяется с позицией на фазе ASSEMBLE

`build()` SHALL сверять роль класса с позицией, в которой он объявлен, и
SHALL завершать фазу ASSEMBLE ошибкой при несовпадении. Текст ошибки SHALL
называть класс, позицию и декоратор, которого она ждёт.

Позиция `providers:` SHALL принимать любую объявленную роль: класс-юнит
пайплайна несёт метод `handle`, то есть роль хендлера, и живёт именно там.
Слот `handler:` SHALL принимать только роль хендлера.

Класс без декоратора роли SHALL быть ошибкой в любой позиции; текст SHALL
предлагать `factoryProvider` для класса из чужого пакета.

Проверка SHALL идти до создания экземпляров: ни один конструктор SHALL NOT
выполняться раньше неё.

#### Scenario: Класс-хендлер endpoint'а в `providers:`

- **WHEN** класс под `@Handler([UserService])` указан в поле `handler`
  декларации и перечислен в `providers:` модуля
- **THEN** сборка падает на фазе ASSEMBLE ошибкой, называющей класс,
  паттерн endpoint'а и модуль (capability `endpoint-handler-di`)

#### Scenario: Юнит пайплайна в `providers:`

- **WHEN** класс под `@Handler([SubscriptionRegistry])` — юнит пайплайна,
  на который не ссылается ни один слот `handler:`, — перечислен в
  `providers:` модуля
- **THEN** он регистрируется обычным узлом графа: `providers:` — его
  штатная позиция, и резолвит его `pipeline.bind`

#### Scenario: Ресурс в слоте `handler:`

- **WHEN** класс под `@Resource([DbConfig])` указан в поле `handler`
  декларации
- **THEN** сборка падает на фазе ASSEMBLE ошибкой, называющей класс, слот
  `handler:` и `@Handler`

#### Scenario: Класс без роли

- **WHEN** класс без декоратора роли перечислен в `providers:`
- **THEN** сборка падает ошибкой, называющей класс и предлагающей
  `factoryProvider` для класса из чужого пакета

### Requirement: DI-токен интерфейса назначает только `classProvider`

Привязка «DI-токен интерфейса и его реализация» SHALL выражаться
единственным способом — `classProvider(Token, Class)` в `providers:`.
Декораторы роли SHALL NOT принимать DI-токен.

`classProvider` SHALL принимать только класс с ролью компонента или
ресурса; зависимости SHALL браться из метаданных декоратора.

#### Scenario: Регистрация под DI-токеном интерфейса

- **WHEN** класс объявлен `@Component([]) class ConsoleLogger implements Logger`
  и зарегистрирован `classProvider(RootLogger$, ConsoleLogger)`
- **THEN** контейнер отдаёт его по DI-токену `RootLogger$`

#### Scenario: DI-токен в декораторе

- **WHEN** код пишет `@Component(RootLogger$, [])`
- **THEN** это ошибка компиляции: у декоратора одна форма — список
  зависимостей

#### Scenario: `classProvider` от класса без роли

- **WHEN** в `classProvider` передан класс без декоратора роли
- **THEN** вызов бросает ошибку, называющую класс и предлагающую
  `factoryProvider`

### Requirement: Список зависимостей сверяется с параметрами роли

Сверка списка зависимостей по типам, порядку и длине (capability
`injectable-dependency-list`) SHALL применяться ко всем трём декораторам.
У `@Component` и `@Handler` эталон — параметры конструктора, у `@Resource`
— параметры `static acquire` без последнего (`signal`).

`Family.auto` в списке SHALL резолвиться при декорировании любой из трёх
ролей (capability `consumer-aware-tokens`).

#### Scenario: Лишний токен у компонента

- **WHEN** класс с конструктором из одного параметра объявлен
  `@Component([Database, Logger$])`
- **THEN** это ошибка компиляции, называющая длину списка и число
  параметров

#### Scenario: Список ресурса сверяется с `acquire`

- **WHEN** класс со `static acquire(config: DbConfigValues, signal: AbortSignal)`
  объявлен `@Resource([DbConfig])`
- **THEN** код компилируется; `@Resource([DbConfig, Logger$])` — ошибка
  компиляции

#### Scenario: `Family.auto` у хендлера

- **WHEN** класс объявлен `@Handler([Logger$.auto])`
- **THEN** в метаданные записан член `Logger$('<имя класса>')`
