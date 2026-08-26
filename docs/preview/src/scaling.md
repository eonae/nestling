[Nestling](index.html) / Масштабирование
{.crumbs}

# Масштабирование

Один бинарник, разные топологии. Как вырасти от одной фичи до модульного монолита, разнесённого по процессам — **не переписывая бизнес-код**.
{.lead}

## Модульный монолит {#monolith}

Гипотеза Nestling: перспективный способ структурировать проекты до ~1M строк — модульный монолит, который умеет запускать **выбранное подмножество фич**. Локально — все фичи в одном процессе (`--features=all`); в проде — тяжёлые фичи по отдельным подам.

Два уже принятых свойства делают ~80% этой модели бесплатной:

- **модули — plain values** ⇒ фича = значение, «выбрать подмножество» = отфильтровать массив в composition root;
- **жадный контейнер** ⇒ «не выбрал фичу → её провайдеры не построились» получается само собой.

### Прогрессивное раскрытие

Главный принцип: **приложение из одной фичи выглядит так, будто фич нет вообще**. Машинерия фич, портов и шины опциональна и аддитивна — за неё не платишь, пока она не нужна. Composition root — это одна функция `assemble(...)` с опциональными полями:

```ts assemble (сигнатура)
assemble({
  modules?,     // L0  базовые модули
  config?,      // L1  привязка источников конфига
  features?,    // L2  бандлы модулей
  select?,      // L2  какие фичи поднять: 'all' | 'orders,billing'
  transports?,  // L0+ транспорты как провайдеры
  dispatch?,    // L4  'local-first' | 'always-remote' | 'balanced'
}): App         // → app.run()
```

## Прогрессия L0 → L4 {#levels}

Одна и та же система, раскрываемая слоями. Нижние уровни не меняются, когда подключаешь верхние.

| Уровень | Что добавляешь | Чего ещё нет |
| --- | --- | --- |
| **L0** | модули + транспорт | features, select, конфиг-модуль, порты, шина |
| **L1** | типизированный конфиг | features, select, порты, шина |
| **L2** | `makeFeature` + `select` | порты, шина — всё co-located |
| **L3** | `makeContract` + порты (co-located) | шина — dispatch внутри процесса |
| **L4** | NATS + dispatch-policy | — split-развёртывание |

:::note good Ключевое
**Код фич и эндпоинтов между L3 и L4 не меняется.** Разнесение по процессам — это разница в composition root и конфиге, а не в бизнес-коде. И L0 нигде не упоминает `feature`/`port`/`select`.
:::

### L2 — фичи и select

Фича — это бандл модулей, тоже значение. Селектор отдаёт в контейнер модули выбранных фич:

```ts main.ts
export const OrdersFeature  = makeFeature({ name: 'orders',  modules: [OrdersModule] });
export const BillingFeature = makeFeature({ name: 'billing', modules: [BillingModule] });

const cfg = await load(RootConfig);       // примордиальное чтение select (фаза 0)
await assemble({
  features: [OrdersFeature, BillingFeature],
  select: cfg.FEATURES,                   // 'all' локально, 'orders' в отдельном поде
  transports: [http({ port: 3000 })],
}).run();
```

Не выбрал фичу → её провайдеры не построились (жадный контейнер), её эндпоинтов нет (дискавери идёт по дереву выбранных модулей, а не из глобального registry). Всё ещё один процесс, шина не нужна.

## Порты и контракты {#ports}

Как фичи общаются, определяет, будет ли монолит **splittable** — или превратится в distributed monolith. Nestling отвечает **портами поверх контрактов**. Один и тот же call-site A→B работает и co-located (через DI, синхронно), и split (по сети, async) — **без переписывания A**.

### Как разрешается противоречие с «no magic»

Location transparency в лоб противоречит принципу «нет рантайм-магии». Разрешение: индиректность резолвится **на сборке, а не на запросе**. Порт биндится на локальный или удалённый клиент в composition root (по выбору фич и топологии). На запросе A зовёт конкретную константу — никакой рантайм-диспетчеризации.

### Контракт — направление-нейтральное значение

```ts billing/contracts.ts
export const ChargeCard = makeContract({
  name: 'billing.charge',
  kind: 'request',                        // request-reply, Fail-able, 1 владелец
  input:  z.object({ orderId: z.string(), amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
});
```

| Вид | Семантика | Для чего |
| --- | --- | --- |
| `request` | req-reply, Fail-able, 1 владелец | честный запрос с ответом |
| `command` | fire-and-forget, 1 обработчик, queue-group | команда; N реплик делят нагрузку |
| `event` | broadcast, 0..N подписчиков | уведомление; событийный дефолт |

### Половина портов уже есть

Inbound («я обрабатываю контракт») — это **буквально endpoint** на messaging-транспорте. Outbound («я зову контракт») — единственное новое: типизированный клиент. Владелец реализует, потребитель инжектит `Contract.port`:

```ts
// billing РЕАЛИЗУЕТ контракт как endpoint
@Injectable([PaymentGateway])
@ContractEndpoint(ChargeCard)
export class ChargeCardEndpoint implements Handler<typeof ChargeCard> {
  constructor(private gw: PaymentGateway) {}
  async handle(input, meta) {
    return new Ok({ chargeId: await this.gw.charge(input, meta.signal) });
  }
}

// orders ПОТРЕБЛЯЕТ порт — не зная, локальный billing или за сетью
@Injectable([OrdersService, ChargeCard.port])
@HttpEndpoint('POST', '/orders', { input: NewOrder, output: Order, pipeline: base })
export class CreateOrderEndpoint implements IEndpoint {
  constructor(private orders: OrdersService, private billing: Port<typeof ChargeCard>) {}
  async handle(input: NewOrder, meta): Output<Order> {
    const charge = await this.billing.call({ orderId: input.id, amount: input.total }, meta);
    if (charge.isFail) return charge;     // отказ — обычный Fail, не исключение
    return new Ok(this.orders.create(input));
  }
}
```

:::note warn Жёсткая дисциплина
Чтобы монолит остался splittable, порты подчиняются трём правилам, даже co-located: порт **никогда не транзакционен** (общая транзакция сломается при split); локальный порт **обязан уметь падать** (`Ok|Fail`) — иначе потребители не обработают отказ, и split их убьёт; кросс-фичевая согласованность — это **события + outbox/saga**, а не общая транзакция. Тип call-site у co-located и split идентичен — потому что завтра это может стать сетью.
:::

Границу порта переживают и отказ, и контекст. Remote-`Fail`**ре-гидрируется** на клиентской стороне в настоящий `Fail` — идентичность доменной ошибки задаёт её `code`, поэтому `OrderNotFound.is(x)` работает одинаково для локального отказа и приехавшего по проводу. А [context-vars](fundamentals.html#context) с `propagate: true` (traceId, requestId) едут в заголовках сообщения — транспорт на той стороне открывает scope заново.

### L4 — split без правки кода фич

Меняется **только** composition root и конфиг. Эндпоинты и сервисы — те же:

```ts main.ts
await assemble({
  features: [OrdersFeature, BillingFeature],
  select: cfg.FEATURES,                   // 'orders' здесь, 'billing' в другом поде
  transports: [http(), nats()],           // NATS — outbound-транспорт для портов
  dispatch: 'local-first',                // co-located → in-proc, иначе → NATS
}).run();
```

`select='orders'` + billing не выбран → `ChargeCard.port` биндится на remote-клиент поверх NATS; billing в своём поде экспонирует `billing.charge` (queue-group для реплик). `select='all'` без NATS → всё co-located, порт локальный. **Один бинарник, разные топологии — за счёт конфига.**

## Транспорты {#transports}

Транспорт — переводчик провода в абстрактную модель и обратно. Он строит `RequestContext` из байтов, вызывает пайплайн (не зная о его фазах) и сериализует `ResponseContext`. Всё, что про *байты* — парсинг, multipart, сжатие, CORS, таймауты — живёт здесь, а не в пайплайне.

### Транспорты — это провайдеры

Транспорт — синглтон с зависимостями и lifecycle, поэтому он **обычный провайдер**, а не мешок `transports: Record` в конструкторе. Отсюда следует: «какие транспорты существуют» выводится из `select`, endpoint ссылается на транспорт токеном, а capability negotiation растворяется в DI + fail-fast (нет транспорта для endpoint'а → ошибка сборки).

| Транспорт | Пакет | `pattern` | Способности |
| --- | --- | --- | --- |
| HTTP | `@nestling/transport.http` | `'POST /orders'` | find-my-way routing, busboy multipart, NDJSON/SSE, лимит тела, graceful close |
| CLI | `@nestling/transport.cli` | `'process'` (команда) | single-shot и REPL, stdin как `stream` |
| NATS | `@nestling/transport.nats` | subject контракта | inbound + outbound, queue-groups, JetStream для durable |

Единый пайплайн обслуживает все транспорты — потому что он оперирует значениями, а не `IncomingMessage`/`ServerResponse`. Тот же endpoint, что отвечает на HTTP, может отвечать на команду CLI и на сообщение NATS. NATS при этом — не особая «messaging-подсистема», а транспорт с двумя способностями (inbound + outbound) в одном мешке; NATS-специфика (JetStream, wildcard, ack) не протекает в контрактный API — та же дисциплина границы, что и с RxJS.

:::note Итог
Endpoint провенанс-слеп и транспорт-слеп. Тот же бизнес-код работает локально или в split, с конфигом из env или Vault, на HTTP или на шине — без правок. Kernel поглощает окружение; user-space остаётся чистым. В этом вся ставка Nestling: структура NestJS без его рантайм-магии, с гарантиями вместо конвенций.
:::
