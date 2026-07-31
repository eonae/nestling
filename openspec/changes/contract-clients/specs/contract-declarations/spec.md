## MODIFIED Requirements

### Requirement: Контракт — направление-нейтральное значение с тремя видами

`@nestling/contracts` SHALL экспортировать
`makeContract({ name, kind, input?, output?, errors?, durable?, http? })`,
возвращающий значение-контракт. Значение SHALL быть неизменяемым и SHALL NOT
регистрироваться ни в модуле, ни в приложении: на приложение контракт влияет
только через `implement(...)` (реализация) и через инжект вызывателя
(потребление).

`@nestling/ports` SHALL NOT реэкспортировать `makeContract` и типы
контракта: дом декларации — пакет без серверных зависимостей (capability
`contracts-package-boundary`).

Поле `kind` SHALL принимать ровно три значения:

- `request` — request-reply, Fail-able, ровно один владелец;
- `command` — fire-and-forget, ровно один обработчик (реплики делят нагрузку);
- `event` — broadcast-факт, 0..N подписчиков.

Поле `name` SHALL быть непустой строкой и SHALL быть **адресом**: оно же
subject шины, оно же ключ дискавери. Версия контракта SHALL выражаться частью
имени (`user.create.v2`) — отдельного поля версии SHALL NOT существовать.

Поля `input`/`output` SHALL принимать io-формы ядра (значение-схема и
обёртки форм), `errors:` — список определений `defineFail` с теми же
проверками, что и в словаре endpoint-декларации (элемент, не являющийся
определением, и повторяющийся `code` — ошибка в точке создания).

Поле `durable` SHALL объявлять долговечность доставки и SHALL быть допустимо
только у видов `command` и `event`; у `request` оно SHALL отвергаться в
момент создания. Семантика флага и его обслуживание транспортом —
capability `durable-delivery`.

Поле `http` SHALL объявлять адресацию контракта на HTTP-проводе — так же,
как `name` объявляет адрес на шине. Форма записи, разворачивание в
bind-карту в момент создания и набор проверок — capability
`contract-http-binding`; поле необязательно, и его отсутствие SHALL NOT
влиять ни на что, кроме доступности контракта внешнему HTTP-клиенту.

#### Scenario: Объявление request-контракта

- **WHEN** объявлено `makeContract({ name: 'billing.charge', kind: 'request', input: ChargeInput, output: ChargeResult, errors: [CardDeclined] })`
- **THEN** результат — значение с этими полями, ничего не зарегистрировавшее
  ни в одном модуле

#### Scenario: Вид вне словаря отвергается

- **WHEN** объявлено `makeContract({ name: 'x', kind: 'query' })`
- **THEN** вызов бросает ошибку, называя контракт и три допустимых вида

#### Scenario: Пустое имя отвергается

- **WHEN** объявлено `makeContract({ name: '', kind: 'event' })`
- **THEN** вызов бросает ошибку в точке создания

#### Scenario: Дубль кода в `errors:`

- **WHEN** в `errors:` контракта дважды указан отказ с кодом `CARD_DECLINED`
- **THEN** вызов бросает ошибку, называя контракт и код

#### Scenario: Долговечное событие

- **WHEN** объявлено `makeContract({ name: 'orders.placed', kind: 'event', durable: true, … })`
- **THEN** значение несёт флаг, и он доезжает до реализации и до вызывателя

#### Scenario: `durable` у `request` отвергается

- **WHEN** объявлено `makeContract({ name: 'billing.charge', kind: 'request', durable: true })`
- **THEN** вызов бросает ошибку в точке создания, называя контракт и вид

#### Scenario: Контракт объявлен с HTTP-адресом

- **WHEN** объявлено `makeContract({ name: 'users.create', kind: 'request', http: 'POST /users', input: CreateUser, output: User })`
- **THEN** значение несёт HTTP-адресацию и bind-карту, оставаясь тем же
  контрактом шины под именем `users.create`

#### Scenario: Импорт из `@nestling/ports` не резолвится

- **WHEN** код импортирует `makeContract` из `@nestling/ports`
- **THEN** это ошибка компиляции
