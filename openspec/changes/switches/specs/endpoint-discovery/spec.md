## MODIFIED Requirements

### Requirement: Источник дискавери — состав приложения

`App` SHALL определять множество обслуживаемых эндпоинтов **проходом по
единицам состава**: по выбранным фичам, подключённым плагинам и корню,
объявившему `endpoints:` (capability `composition-root`). Корень такой
формы SHALL участвовать в проходе как единица с именем `app`.

Ветки переключателей в списках единиц SHALL раскрываться до прохода:
discovery SHALL видеть уже выбранный состав (capability
`composition-switches`).

Глобальных реестров, наполняемых при импорте модуля с декларациями, в
публичном API SHALL не быть: функции `registerEndpoint`, `getAllEndpoints`,
`clearEndpointRegistry` SHALL быть удалены из `@nestling/app`. Декларация
эндпоинта SHALL быть значением (см. capability `endpoint-declarations`);
создание декларации SHALL NOT иметь побочных эффектов, а
декораторов-носителей метаданных эндпоинта SHALL NOT существовать.

#### Scenario: Импорт файла с декларацией не влияет на приложение

- **WHEN** файл с декларацией `httpEndpoint({ … })` импортирован
  (транзитивно, через barrel или тест), но объявившая его единица в
  приложение не передана
- **THEN** приложение поднимается штатно, эндпоинт не регистрируется ни в
  одном транспорте и ошибки старта нет

#### Scenario: Обслуживается ровно то, что объявлено единицами

- **WHEN** `App` собран из `features: [A]`, при этом фича `B` с
  эндпоинтами импортирована в том же процессе, но в корень не передана
- **THEN** в транспортах зарегистрированы только эндпоинты фичи `A`

#### Scenario: Endpoint'ы корня попадают в discovery

- **WHEN** `App` объявлен формой `{ endpoints: [CreateOrder], providers: [OrdersService] }`
- **THEN** результат discovery содержит `CreateOrder` с атрибуцией к
  единице `app`

#### Scenario: Невыбранная ветка в discovery не участвует

- **WHEN** корень объявляет `endpoints: [CreateOrder, Debug.when(DumpOrders)]`,
  и сборка идёт с `debug=off`
- **THEN** discovery находит один endpoint, и `DumpOrders` не
  зарегистрирован ни в одном транспорте

#### Scenario: Реестра нет в публичном API

- **WHEN** код импортирует `registerEndpoint`, `getAllEndpoints` или
  `clearEndpointRegistry` из `@nestling/app`
- **THEN** импорт не резолвится (ошибка компиляции)
