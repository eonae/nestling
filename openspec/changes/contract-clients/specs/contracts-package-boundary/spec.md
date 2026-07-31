## ADDED Requirements

### Requirement: `@nestling/contracts` — единственный дом декларативного слоя

Пакет `@nestling/contracts` SHALL быть домом направление-нейтральных
деклараций и SHALL экспортировать:

- `makeContract` и типы контракта;
- `defineFail`, определения kernel-отказов (включая `UnknownError`),
  `Ok`, `Fail`, `isFail` и словари статусов;
- формы io (`stream`, `events`, `multipart`, `upload`) и их описатели;
- пометки размещения `query()`/`body()`, тип bind-карты и её вычисление.

Перечисленные символы SHALL иметь ровно один физический дом: дублирующих
определений (второй `Fail`, второй `defineFail`) SHALL NOT существовать.

#### Scenario: Контракт объявляется из одного пакета

- **WHEN** модуль импортирует `makeContract`, `defineFail` и формы io
- **THEN** все они доступны из `@nestling/contracts`

#### Scenario: Идентичность значений не двоится

- **WHEN** `Fail`, полученный из `@nestling/contracts`, и `Fail`,
  полученный реэкспортом из `@nestling/pipeline`, сравниваются
- **THEN** это одно и то же значение

### Requirement: Граф импортов пакета не содержит серверного кода

Замыкание импортов `@nestling/contracts` SHALL NOT содержать
`@nestling/container` (главный экспорт), `@nestling/pipeline`,
`@nestling/app`, транспортов, `@nestling/config` и модулей `node:*`.
Внешних runtime-зависимостей у пакета SHALL NOT быть: транзитивно
допустим только `@standard-schema/spec` (типы).

Примитив токена инжекции SHALL импортироваться subpath-экспортом
`@nestling/container/tokens`, отдающим листовые модули без
runtime-импортов, — чтобы членство `.port`/`.emitter` в семействах
регистрировалось штатно, а билдер графа в замыкание не попадал.

Инвариант SHALL проверяться тестом, обходящим граф импортов собранного
пакета, а не декларироваться в README: гарантия не должна зависеть от
tree-shaking в инструменте потребителя.

#### Scenario: Тест ловит запрещённый импорт

- **WHEN** в исходники `@nestling/contracts` добавлен импорт
  `@nestling/pipeline` или `node:crypto`
- **THEN** тест границы падает, называя модуль и запрещённый импорт

#### Scenario: Контракты импортируются во фронтовую сборку

- **WHEN** фронтовый бандл импортирует `@nestling/contracts` и
  `@nestling/client`
- **THEN** в бандл не попадают контейнер, pipeline, транспорты и
  Node-специфика

#### Scenario: Вызыватели остаются членами семейств

- **WHEN** контракт, созданный из `@nestling/contracts`, реализован и его
  `.port` инжектирован
- **THEN** токен распознаётся как член семейства вызывателей — так же, как
  до переезда

### Requirement: Реэкспорт сохраняет прежнюю поверхность, кроме `makeContract`

Символы, переехавшие в `@nestling/contracts`, SHALL оставаться доступными
из пакетов, которые экспортировали их прежде:

- `@nestling/pipeline` SHALL реэкспортировать `Ok`, `Fail`, `isFail`,
  статусы, `defineFail`, kernel-отказы и формы io;
- `@nestling/transport.http` SHALL реэкспортировать `query()`, `body()` и
  тип bind-карты.

`@nestling/ports` SHALL NOT реэкспортировать `makeContract` и типы
контракта: этот реэкспорт вернул бы декларацию контракта в пакет с
серверными зависимостями и сделал бы упаковочную гарантию вопросом
дисциплины импортов. Канонический импорт `makeContract` SHALL быть
`@nestling/contracts`, и примеры с гайдами SHALL использовать его.

#### Scenario: Хендлер не меняет импортов

- **WHEN** существующий код импортирует `Fail` и `defineFail` из
  `@nestling/pipeline`
- **THEN** он компилируется и работает как прежде

#### Scenario: `makeContract` из `@nestling/ports` не резолвится

- **WHEN** код импортирует `makeContract` из `@nestling/ports`
- **THEN** это ошибка компиляции, а сообщение о недоступном экспорте
  указывает на `@nestling/contracts`

### Requirement: `@nestling/client` не зависит от серверных пакетов

`@nestling/client` SHALL зависеть только от `@nestling/contracts` и SHALL
использовать `fetch` без Node-специфики. Замыкание импортов SHALL
проверяться тем же тестом границы, что и у пакета контрактов.

#### Scenario: Клиент собирается для браузера

- **WHEN** `@nestling/client` собирается в бандл без Node-полифиллов
- **THEN** сборка проходит: ни `node:*`, ни серверных пакетов в замыкании
  нет
