## MODIFIED Requirements

### Requirement: `assemble` — единственный публичный composition root

`@nestling/app` SHALL экспортировать функцию
`assemble({ modules?, providers?, features?, select?, transports?, config?, policies? }): App`.
Каждое поле SHALL быть опциональным. Приложение уровня L0 (модули +
транспорт) SHALL NOT упоминать `feature`, `select`, конфиг-привязки или
инварианты.

Поле `policies?` SHALL принимать список значений-политик — инвариантов,
проверяемых на собранном приложении (capability `assembly-policies`). Оно
SHALL оставаться опциональным: приложение без инвариантов собирается ровно
как прежде.

Публичного конструктора приложения SHALL NOT существовать: `App` SHALL
оставаться экспортированным типом результата с методами `run()` и `close()`,
а его конструктор SHALL принимать внутренний нормализованный план сборки,
тип которого не экспортируется, — так `new App({ … })` невыразим по типам
без рантайм-проверок.

#### Scenario: L0 — модули и транспорт

- **WHEN** написано `await assemble({ modules: [OrdersModule], transports: [http({ port: 3000 })] }).run()`
- **THEN** приложение поднимается, HTTP-ручки модуля обслуживаются, и в
  корне не упоминается ни фича, ни `select`, ни конфиг, ни политики

#### Scenario: Приложение нельзя собрать конструктором

- **WHEN** код пишет `new App({ modules: [OrdersModule] })`
- **THEN** это ошибка компиляции: тип плана сборки не экспортируется

#### Scenario: Пустая сборка легальна

- **WHEN** вызвано `assemble({})`
- **THEN** приложение собирается и поднимается без транспортов и ручек

#### Scenario: Инварианты объявлены полем корня

- **WHEN** написано `assemble({ features: [UsersFeature], transports: [http()], policies: [everyEndpoint({ transport: HttpTransport$ }).hasLayer(authedBase)] })`
- **THEN** политики проверяются на фазе ASSEMBLE того же прогона, отдельной
  функции запуска проверок не существует
</content>
