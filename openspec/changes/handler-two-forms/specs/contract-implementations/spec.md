# contract-implementations Specification (delta)

## MODIFIED Requirements

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

Значение SHALL объявляться в `endpoints:` модуля и SHALL участвовать во всей
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
