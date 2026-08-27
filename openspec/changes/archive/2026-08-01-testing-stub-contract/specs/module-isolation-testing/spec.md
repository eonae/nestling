# module-isolation-testing

## MODIFIED Requirements

### Requirement: `testModule` поднимает один модуль в изоляции

`@nestling/testing` SHALL экспортировать
`testModule(module, options?): Promise<TestApp>`, собирающую мини-приложение
вокруг одного модуля (с его `imports`), kernel-модулем конфига и
перечисленными стабами. Результат SHALL быть тем же `TestApp`, что у
`assembleTest`: те же фазы 0–3, те же `call`/`get`/`close`.

Поле `stubs` SHALL принимать пары «токен → значение» — для модуля в изоляции
это поставка недостающего, а не подмена. Поле SHALL принимать значения
`stub(Contract, impl)` наравне с обычными парами: контрактный стаб — такая же
пара «токен вызывателя → фейк» (capability `contract-stubs`), поэтому
меж-фичевый вызов, объявленный модулем, поставляется тем же полем, что и
недостающий провайдер.

#### Scenario: Модуль без соседей

- **WHEN** `await testModule(UsersModule, { stubs: [[ILogger, noopLogger]] })`
- **THEN** приложение собрано из одного модуля, его ручки вызываются через
  `app.call`

#### Scenario: Токены видны без экспорта

- **WHEN** тест лежит внутри пакета модуля и называет его внутренний токен
- **THEN** стаб ставится без добавления токена в публичный экспорт пакета

#### Scenario: Меж-фичевый вызов поставляется тем же полем

- **WHEN** модуль инжектит `ChargeCard.port`, и тест зовёт
  `await testModule(OrdersModule, { stubs: [stub(ChargeCard, async () => ({ chargeId: 'c1' }))] })`
- **THEN** мини-приложение собирается без реализации контракта, а вызов
  порта из модуля обслуживает фейк
