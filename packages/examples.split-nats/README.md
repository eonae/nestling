# examples.split-nats — split-развёртывание через NATS

Пример существует ради одного утверждения из
[`docs/design/composition.md`](../../docs/design/composition.md):
**код фич между L3 и L4 не меняется**. Здесь оно проверяемо, а не обещано.

## Что внутри

Две фичи, общающиеся только контрактами:

| Фича | Что делает |
|---|---|
| `orders` | принимает команду `orders.place`, зовёт `quotas.claim`, эмитит `orders.placed` |
| `quotas` | владеет `quotas.claim`, слушает `orders.placed` подписчиком `archive` |

Ни одна из них не экспортирует токен наружу и не знает ни слова про
брокер, процессы или транспорт. Всё, что они знают, — контракты
([`contracts.ts`](./src/contracts.ts)).

Composition root — **один** ([`root.ts`](./src/root.ts)) на все процессы.
Между запусками меняется ровно `select`:

```bash
# L3 — обе фичи одним процессом
APP_FEATURES=all yarn workspace examples.split-nats start:dev

# L4 — две половины, два процесса
APP_FEATURES=quotas yarn workspace examples.split-nats start:dev
APP_FEATURES=orders yarn workspace examples.split-nats start:dev
```

Состав транспортов при этом статичен: `nats()` стоит в `transports:`
безусловно. Тернарника `NATS_URL ? nats() : undefined` в примере нет и не
будет — он был бы враньём о том, чем приложение является.

## Что именно доказывает пример

1. **Remote-биндинг.** Процесс `orders` собирается, хотя ни один выбранный
   модуль не реализует `quotas.claim`. До появления remote-шины это была
   ошибка ASSEMBLE; теперь «владельца не выбрали здесь» означает «он в
   другом процессе».
2. **Call-site не меняется.** `PlaceOrderService` инжектит `ClaimQuota.port`
   и зовёт `call(...)` одинаково в обеих топологиях.
3. **Долговечность объявлена контрактом.** `orders.placed` несёт
   `durable: true`, поэтому под ним поток JetStream: подписчик, лежавший в
   момент публикации, факт не потеряет.
4. **Провоз контекста.** `TenantId` объявлен `{ propagate: true }` и
   доезжает до реализации в другом процессе через **два** hop'а: внешний
   драйвер кладёт его в конверт, `orders` проецирует штатным
   `TenantId.propagated()`, а вызыватель собирает его из ячейки запроса и
   кладёт в конверт следующего вызова сам.

Проверяется это [`split.spec.ts`](./src/split.spec.ts) — на in-memory
двойнике брокера, без сети.

## Запуск с настоящим брокером

```bash
docker run --rm -p 4222:4222 nats:2 -js
```

Адрес приходит из секции `nats` (`NATS_SERVERS`, умолчание
`nats://127.0.0.1:4222`), поэтому кода это не касается. JetStream (`-js`)
обязателен: без него не поднимется поток под `orders.placed`.

Внешний драйвер — обычный `nats pub`:

```bash
nats pub orders.place '{"orderId":"o-1","amount":10}' -H 'Nl-Ctx:{"tenantId":"acme"}'
```
