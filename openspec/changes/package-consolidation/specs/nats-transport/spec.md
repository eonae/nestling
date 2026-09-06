## MODIFIED Requirements

### Requirement: `@nestling/transport.nats` — шина приложения, поставляемая корнем

Пакет `@nestling/transport.nats` SHALL экспортировать фабрику `nats(options?)`,
возвращающую **обычный транспорт-провайдер** под токеном транспорта шины
(`BusTransport$` из `@nestling/app`), и класс `NatsBus`, реализующий
одновременно `IMessageBus` (исходящая сторона) и `ITransport` (входящая).
Отдельной сущности «messaging» рядом с «transports» SHALL NOT существовать.

`nats()` SHALL перечисляться в `transports:` словаря `makeApp`; поля `bus:`
или иной новой оси в корне SHALL NOT появляться. Когда корень поставил
транспорт шины, kernel-модуль портов SHALL NOT регистрировать `InProcessBus`
(capability `message-bus`), и `MessageBus$` SHALL разрешаться в тот же
инстанс: шина в приложении SHALL быть ровно одна.

`NatsBus` SHALL объявлять себя remote-шиной (`remote === true`), и этот
признак SHALL быть входом биндинга вызывателей (capability `port-binding`).

Ни одна декларация `implement(...)`, ни одна операция и ни один call-site
SHALL NOT требовать изменений при подключении или отключении `nats()`.

#### Scenario: Подключение брокера — правка корня и конфига

- **WHEN** в `transports:` добавлен `nats()`
- **THEN** приложение собирается, шиной приложения становится `NatsBus`, а
  декларации реализаций и вызовы портов не меняются

#### Scenario: In-proc шина не регистрируется

- **WHEN** корень поставил транспорт шины
- **THEN** `InProcessBus` в графе отсутствует, а `MessageBus$` и токен
  транспорта шины дают один и тот же инстанс

#### Scenario: Откат к in-proc шине

- **WHEN** `nats()` убран из `transports:`
- **THEN** приложение собирается на `InProcessBus`, а декларации и call-site
  остаются прежними

#### Scenario: Две шины в одном приложении

- **WHEN** корень регистрирует два провайдера транспорта шины
- **THEN** сборка падает на конфликте токена — как для любого дублирующего
  провайдера
