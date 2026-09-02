# examples.split-nats: split-развёртывание через NATS

Пример показывает утверждение из
[`docs/design/composition.md`](../../docs/design/composition.md): код фич
не меняется, когда приложение разносят по процессам. Здесь это проверяется
тестом.

## Что внутри

Две фичи общаются только контрактами:

| Фича | Что делает |
|---|---|
| `orders` | принимает команду `orders.place`, вызывает `quotas.claim`, публикует событие `orders.placed` |
| `quotas` | реализует `quotas.claim`, подписана на `orders.placed` как подписчик `archive` |

Ни одна из фич не экспортирует свои токены и ничего не знает о брокере,
процессах и транспорте. Единственное общее знание — контракты в
[`contracts.ts`](./src/contracts.ts).

Composition root один на все процессы ([`root.ts`](./src/root.ts)).
Между запусками меняется только `select`:

```bash
# обе фичи одним процессом
APP_FEATURES=all yarn workspace examples.split-nats start:dev

# две половины, два процесса
APP_FEATURES=quotas yarn workspace examples.split-nats start:dev
APP_FEATURES=orders yarn workspace examples.split-nats start:dev
```

Состав транспортов при этом не меняется: `nats()` всегда стоит в
`transports:`.

## Что показывает пример

1. **Remote-биндинг.** Процесс `orders` собирается, хотя ни один выбранный
   модуль не реализует `quotas.claim`: раз владельца нет в этом процессе,
   он в другом, и вызов идёт через брокер.
2. **Код вызова не меняется.** `PlaceOrderService` инжектит
   `ClaimQuota.caller` и вызывает `call(...)` одинаково в обеих топологиях.
3. **Долговечность объявлена в контракте.** У `orders.placed` стоит
   `durable: true`, поэтому под ним создаётся поток JetStream: подписчик,
   недоступный в момент публикации, событие не потеряет.
4. **Передача контекста.** `TenantId` объявлен с `{ propagate: true }` и
   доходит до реализации в другом процессе через два перехода: внешний
   драйвер кладёт его в заголовок сообщения, `orders` читает его юнитом
   `TenantId.propagated()`, а при вызове `quotas.claim` вызывающая сторона
   снова кладёт его в заголовок.

Всё это проверяет [`split.spec.ts`](./src/split.spec.ts) на двойнике
брокера в памяти, без сети.

## Запуск с настоящим брокером

```bash
docker run --rm -p 4222:4222 nats:2 -js
```

Адрес брокера приходит из секции конфига `nats` (`NATS_SERVERS`, по
умолчанию `nats://127.0.0.1:4222`). JetStream (`-js`) обязателен: без него
не создастся поток под `orders.placed`.

Отправьте команду через `nats pub`:

```bash
nats pub orders.place '{"orderId":"o-1","amount":10}' -H 'Nl-Ctx:{"tenantId":"acme"}'
```
