# @nestlingjs/transport.nats

NATS как шина приложения: доставляет вызовы операций между процессами в обе
стороны. `NatsBus` реализует `IMessageBus` наружу и `ITransport` внутрь,
поэтому отдельной сущности «messaging» рядом с транспортами нет.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/transports.md`](../../docs/design/transports.md) §5.
> Гайд: [глава 20. Разнести фичи по процессам](../../docs/guide/20-split.md).

## Установка

```bash
npm install @nestlingjs/transport.nats nats
```

`nats` — peer-зависимость: ставится клиент той версии, что у брокера.

## Минимальный пример

```typescript
import { nats } from '@nestlingjs/transport.nats';

export const app = makeApp({
  features: [OrdersFeature, BillingFeature],
  transports: [http(), nats({ name: 'events' })],
  intercom: 'events',
});

// Декларации, операции и код вызовов при добавлении nats() не меняются.
await app.assemble(load(RootConfig).features).run();
```

## Экспорты

- **Транспорт** ([design](../../docs/design/transports.md)) — `nats`,
  `NatsBus`, `NatsTransportOptions`, `natsConfigKeys`.
- **Соединение** — `NatsConnectionInfo`, `NatsDeliveryFailure`.
- **Шов коннектора** — `NatsConnector`, `NatsConnectOptions`, `NatsLike`.
  Свой клиент брокера подставляется опцией фабрики; формы сообщений и
  JetStream входят в `NatsLike`, называть их для этого не нужно.
- **Адресация** — `consumerNameOf`, `groupOf`, `streamNameOf`,
  `SUBJECT_HEADER`, `CONTEXT_HEADER`, `IDEMPOTENCY_HEADER`, `TIMEOUT_HEADER`.
- **Кодек** — `jsonCodec`, `NatsCodec`.
- **Подпуть `./testing`** — `natsDouble`, `NatsDouble`, `NatsDoubleError`,
  `HeadersDouble`, `subjectMatches`, `DEFAULT_MAX_DELIVER`,
  `NATS_CONNECTION_CLOSED`, `NATS_NO_RESPONDERS`, `NATS_TIMEOUT`.

Двойник из `./testing` подставляется опцией `connector` и проигрывает
доставку в памяти: тест видит те же subject'ы, заголовки и повторы.
Подпуть резолвится только под условием `testing` — тест-раннер включает его
сам, Node принимает флагом `--conditions=testing`.

## Границы пакета

Пакет не поднимает брокер и не заводит стримы за пределами тех, что нужны
операциям. Формат сообщения задаёт кодек, а семантику доставки —
`docs/design/transports.md`.
