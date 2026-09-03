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
существующей машинерии наравне с HTTP- и CLI-ручками: дискавери из дерева
выбранных модулей, `makeDispatch`, исполнение через pipeline, страж границы,
`policies` и `detached`, отчёт `check()`, вызов по идентичности декларации в
тестовом корне.

#### Scenario: Реализация объявляется как ручка

- **WHEN** объявлено `implement(ChargeCard, { pipeline: basePipeline, handler: { deps: [Ledger], handle } })` и значение указано в `endpoints:` модуля
- **THEN** оно обнаруживается дискавери, требует транспорт шины и исполняется
  тем же путём, что HTTP-ручка того же модуля

#### Scenario: Формы хендлера — те же три

- **WHEN** `handler` задан классом с методом `handle`, словарём `{ deps,
  handle }` или функцией без зависимостей
- **THEN** все три формы принимаются и гасятся тем же `resolve`, что у
  прочих деклараций

#### Scenario: Реализация видна политикам

- **WHEN** приложение объявляет политику, требующую слой у каждой ручки, а
  реализация операции собрана без этого слоя
- **THEN** сборка падает на фазе ASSEMBLE, называя реализацию

#### Scenario: Реализация вызывается в тесте по значению

- **WHEN** тест держит значение `ChargeCardImpl` и зовёт `app.call(ChargeCardImpl, payload)`
- **THEN** запрос проходит полный pipeline реализации и возвращает
  `ResponseContext`
