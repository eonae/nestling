# @nestlingjs/transport.nats

NATS как шина приложения: доставляет вызовы операций между процессами в обе
стороны. `NatsBus` реализует `IMessageBus` наружу и `ITransport` внутрь,
поэтому отдельной сущности «messaging» рядом с транспортами нет.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/transports.md`](../../docs/design/transports.md) §5.
> Гайд: [глава 20. Разнести фичи по процессам](../../docs/guide/20-split.md).

## Установка

```bash
npm install @nestlingjs/transport.nats nats zod
```

`nats` — peer-зависимость: ставится клиент той версии, что у брокера. `zod`
тоже приходит от приложения: схему своей секции транспорт пишет им, и копия
валидатора у него и у приложения одна.

## Минимальный пример

```typescript
import { nats } from '@nestlingjs/transport.nats';

export const app = makeApp({
  features: [OrdersFeature, BillingFeature],
  transports: [http(), nats({ name: 'events' })],
  intercom: 'events',
});

// Декларации, операции и код вызовов при добавлении nats() не меняются.
await app.build(argv(process.argv)).run();
```

## Экспорты

- **Транспорт** ([design](../../docs/design/transports.md)) — `nats`,
  `NatsBus`, `NatsTransportOptions`, `natsConfigKeys`.
- **Соединение** — `NatsConnectionInfo`, `NatsDeliveryFailure`.
- **Шов коннектора** — `NatsConnector`, `NatsConnectOptions`, `NatsLike`.
  Свой клиент брокера подставляется опцией фабрики; формы сообщений и
  JetStream входят в `NatsLike`, называть их для этого не нужно.
- **Адресация** — `consumerNameOf`, `groupOf`, `streamNameOf`,
  `SUBJECT_HEADER`, `CONTEXT_HEADER`, `IDEMPOTENCY_HEADER`, `TIMEOUT_HEADER`,
  `MSG_ID_HEADER`. Последний — заголовок брокера: по нему поток снимает
  повтор публикации.
- **Кодек** — `jsonCodec`, `NatsCodec`.
- **Подпуть `./testing`** — `natsDouble`, `NatsDouble`, `NatsDoubleOptions`,
  `NatsDoubleError`, `HeadersDouble`, `subjectMatches`,
  `DEFAULT_MAX_DELIVER`, `NATS_CONNECTION_CLOSED`, `NATS_NO_RESPONDERS`,
  `NATS_TIMEOUT`.

Двойник из `./testing` подставляется опцией `connector` и проигрывает
доставку в памяти: тест видит те же subject'ы, заголовки и повторы.
Подпуть резолвится только под условием `testing` — тест-раннер включает его
сам, Node принимает флагом `--conditions=testing`.

## Границы пакета

`nats()` объявляет шину доставляющей за пределы процесса — полем `remote`
своего объявления. Признак принадлежит объявлению, а не `NatsBus`: читает
его фаза BUILD, где экземпляра шины ещё нет, и из него выбирается путь
вызывателя. Поэтому вызов операции, которую здесь никто не реализует,
проходит `check()`, когда `nats()` назначен интеркомом, и падает на сборке,
когда не назначен.

Пакет не поднимает брокер и не заводит стримы за пределами тех, что нужны
операциям. Формат сообщения задаёт кодек, а семантику доставки —
`docs/design/transports.md`.

Двойник из `./testing` проверяет **наш код**, а не совместимость с
брокером: он ведёт себя так, как мы поняли NATS. Совместимость
подтверждает прогон против настоящего брокера — `yarn test:live` из корня
репозитория. Команда поднимает `nats:2` из `compose.yaml`, гоняет по нему
тесты пакета и останавливает службу; порт хоста задаёт `NATS_LIVE_PORT`,
умолчание — 4222.

Поток собственного создания несёт окно дедупликации: повтор долговечной
публикации с тем же ключом идемпотентности внутри окна брокер снимает сам.
Умолчание — 5 минут, другая величина задаётся опцией фабрики
`dedupeWindowMs`, `0` выключает дедупликацию. Чужой поток транспорт не
переписывает: окно меньше настроенного даёт запись `warn`, а правится оно
командой `nats stream edit <имя> --dupe-window=5m`.

Гарантии «ровно один раз» окно не даёт: у транспорта нет транзакции
приложения, поэтому повтор позже окна доходит до подписчика. За гарантию
отвечает [`@nestlingjs/inbox`](../nestling.inbox/).
