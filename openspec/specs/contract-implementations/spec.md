# contract-implementations

## Purpose

Реализация операции — обычная endpoint-декларация на транспорте шины,
построенная тем же kernel-примитивом `makeEndpoint`, что HTTP- и CLI-ручки.
Она объявляется в `endpoints:` модуля и участвует во всей существующей
машинерии: дискавери, `makeDispatch`, pipeline, страж границы, политики,
`check()`, вызов по значению в тестовом корне. Адрес в процессе (`pattern`) и
адрес на шине (subject) разведены: у события паттерн несёт имя подписчика,
а subject остаётся именем операции.

## Requirements

### Requirement: `implement` строит обычную декларацию на транспорте шины

`@nestling/ports` SHALL экспортировать
`implement(Contract, { pipeline?, handler, subscriber?, detached? })`,
возвращающий `EndpointDefinition`, построенный тем же kernel-примитивом
`makeEndpoint`, что и транспортные конструкторы. Декларация SHALL нести токен
транспорта шины (`transport:bus`) и транспорт-специфичный `binding` с
subject'ом, видом операции и (для `event`) именем подписчика.

`input`, `output` и `errors` декларации SHALL браться из операции и SHALL NOT
переобъявляться в словаре `implement`: интерфейс операции принадлежит
операции, реализация добавляет только исполнение.

Значение SHALL объявляться в `endpoints:` модуля и SHALL участвовать во всём
существующем механизме наравне с HTTP- и CLI-endpoint'ами: discovery из дерева
выбранных модулей, `makeDispatch`, исполнение через pipeline, проверка на границе,
`policies` и `detached`, отчёт `check()`, вызов по идентичности декларации в
тестовом корне.

#### Scenario: Реализация объявляется как endpoint

- **WHEN** объявлено `implement(ChargeCard, { pipeline: basePipeline, handler: ChargeCardHandler })`,
  где `ChargeCardHandler` — класс под `@Injectable([Ledger])` с методом
  `handle`, и значение указано в `endpoints:` модуля
- **THEN** оно обнаруживается discovery, требует транспорт шины и исполняется
  тем же путём, что HTTP-endpoint того же модуля

#### Scenario: Формы хендлера — те же две

- **WHEN** `handler` задан классом с методом `handle` или функцией без
  зависимостей
- **THEN** обе формы принимаются и получают зависимости тем же `resolve`,
  что у прочих деклараций; объект `{ deps, handle }` отвергается так же,
  как у транспортных конструкторов

#### Scenario: Реализация видна политикам

- **WHEN** приложение объявляет политику, требующую слой у каждого endpoint'а, а
  реализация операции собрана без этого слоя
- **THEN** сборка падает на фазе ASSEMBLE, называя реализацию

#### Scenario: Реализация вызывается в тесте по значению

- **WHEN** тест держит значение `ChargeCardImpl` и зовёт `testApp.call(ChargeCardImpl, payload)`
- **THEN** запрос проходит полный pipeline реализации и возвращает
  `ResponseContext`

### Requirement: Адрес в процессе и адрес на шине разведены

`pattern` декларации SHALL быть `<name>` для видов `request` и `command` и
`<name>@<subscriber>` для вида `event`; subject шины SHALL во всех случаях
быть `<name>`.

Поле `subscriber:` SHALL быть обязательным для `event` и SHALL быть
запрещённым для `request`/`command`; нарушение SHALL быть ошибкой в момент
создания декларации с указанием операции и её вида. Имя подписчика SHALL
задаваться автором явно и SHALL NOT выводиться автоматически из имени модуля
или порядкового номера — это адрес подписки, который в будущем становится
именем queue-group и durable-подписки.

#### Scenario: Два подписчика одного события

- **WHEN** две фичи объявляют `implement(OrderPlaced, { subscriber: 'billing', … })`
  и `implement(OrderPlaced, { subscriber: 'analytics', … })`
- **THEN** обе декларации легальны, их паттерны различны, а subject у обеих —
  `orders.placed`

#### Scenario: Событие без имени подписчика

- **WHEN** объявлено `implement(OrderPlaced, { handler: handle })` без `subscriber:`
- **THEN** вызов бросает ошибку, называя операцию, вид `event` и требование
  указать `subscriber`

#### Scenario: Имя подписчика у запроса

- **WHEN** объявлено `implement(ChargeCard, { subscriber: 'billing', handler: handle })`
  для операции вида `request`
- **THEN** вызов бросает ошибку: у запроса ровно один владелец, и подписчиков
  у него не бывает

### Requirement: У `request` и `command` ровно один владелец

Две реализации одной операции вида `request` или `command` в собранном
приложении SHALL быть ошибкой фазы ASSEMBLE. Текст SHALL называть операцию и
**оба** модуля-объявителя.

Для вида `event` количество реализаций SHALL быть любым, включая ноль; два
подписчика с одинаковым `subscriber` SHALL быть ошибкой той же фазы.

#### Scenario: Два владельца запроса

- **WHEN** две выбранные фичи объявляют `implement(ChargeCard, …)`
- **THEN** сборка падает на ASSEMBLE, называя операцию и оба модуля

#### Scenario: Событие без подписчиков

- **WHEN** приложение объявляет операцию-событие и эмиттер, но ни одной
  реализации
- **THEN** сборка проходит: broadcast с нулём подписчиков легален

#### Scenario: Один владелец в этой топологии, второй — в невыбранной фиче

- **WHEN** второй `implement` той же операции живёт в фиче, не попавшей в
  `select`
- **THEN** сборка проходит: дискавери видит только выбранные модули
