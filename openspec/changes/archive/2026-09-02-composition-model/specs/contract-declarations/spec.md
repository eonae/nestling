# contract-declarations Specification (delta)

## MODIFIED Requirements

### Requirement: Три конструктора операций вместо поля вида

Операции SHALL объявляться конструкторами `makeRequest`, `makeCommand` и
`makeEvent`. Конструктор `makeContract` с полем `kind` SHALL быть удалён.

Правила вида SHALL проверяться типом, а не при создании значения:

- `makeEvent` SHALL NOT принимать `output` и `errors`;
- `makeRequest` SHALL NOT принимать `durable`;
- реализация события SHALL требовать `subscriber`, а реализации запроса и
  команды SHALL его запрещать.

Слово «контракт» SHALL NOT использоваться в публичных именах и в
документации; собирательное имя — «операция».

#### Scenario: Выход у события не объявляется

- **WHEN** объявлено `makeEvent('users.registered', { input, output })`
- **THEN** компилятор отвергает объявление

#### Scenario: Долговечность у запроса не объявляется

- **WHEN** объявлено `makeRequest('quotas.claim', { input, output, durable: true })`
- **THEN** компилятор отвергает объявление

### Requirement: Вызывающая сторона называется caller

Токен вызывающей стороны запроса SHALL называться `.caller`. Имя `.port`
SHALL быть удалено.

#### Scenario: Вызов запроса

- **WHEN** декларация объявляет `deps: [ClaimQuota.caller]`
- **THEN** хендлер получает значение с методом `call`
