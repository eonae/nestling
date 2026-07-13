# Composition root и жизненный цикл

🚧 **Статус: дизайн (целевое состояние).** Существует сегодня: `App`,
`makeAppModule`/`makeModule`, `@HttpEndpoint`/`makeEndpoint`, `Ok`/`Fail`,
`compose`/`makePipeline`, `meta.signal`. Проектируется (помечено `proposed`):
`assemble`, `makeFeature` + `select`, `makeContract` + порты, config-модуль,
транспорты-как-провайдеры, фазы `@OnStart`/go-live, единая модель
endpoint-деклараций (`httpEndpoint` + `deps`; декораторные
`@Endpoint`/`@HttpEndpoint` из целевой поверхности удалены —
[ideas.md [2026-07-13]](../decisions/ideas.md) «Endpoint-декларации»).
Документ фиксирует, как эти слои складываются в один жизненный цикл и один
composition root.

---

## 1. Жизненный цикл

```mermaid
flowchart TD
    START([process start]) --> P0
    P0["0 · BOOTSTRAP"] -->|"load + validate config · select"| P1
    P1["1 · ASSEMBLE"] -->|"build граф · discover · bind ports"| P2
    P2["2 · INIT · @OnInit"] -->|"захват ресурсов · connect"| P3
    P3["3 · WIRE"] -->|"регистрация эндпоинтов"| P4
    P4["4 · START · @OnStart"] -->|"serve(dispatch, signal)"| P5
    P5["5 · RUN"] -->|"SIGTERM / SIGINT / close"| P6
    P6["6 · SHUTDOWN · реверс"] --> EXIT([process exit])

    P2 -. "dispatch рождается в WIRE ⇒ listen на @OnInit невозможен" .-> P4
```

**Что происходит в каждой фазе:**

- **0 · BOOTSTRAP** (контейнера ещё нет) — load env / file / Vault
  (единственная точка `process.env`) → validate assembly- и provider-config
  *выбранных* фич → `✗ invalid → FAIL-FAST` (источник моргает → bounded retry,
  потом смерть). Выдаёт `select`, config-значения, policy.
- **1 · ASSEMBLE** (граф строится) — `select` → какие модули идут в билдер;
  discover из дерева модулей (не глобальный registry): providers · endpoints ·
  transports; `build()` жадно (инстанциация · циклы · топосорт); bind ports
  (local | remote поверх шины | `✗ FAIL-FAST`).
- **2 · INIT** (`@OnInit`, топологически) — захват ресурсов: DB-пул, connect
  NATS. Транспорты подключены, **не в эфире**. `dispatch` ещё не существует.
- **3 · WIRE** — endpoints → instance из контейнера; таблица `pattern→handler`
  на транспорт. **`dispatch` рождается здесь.**
- **4 · START** (`@OnStart`, топологически) — `serve(dispatch, signal)`, не
  `listen()`. HTTP слушает сокет, NATS — `subscribe` (queue-group для реплик).
- **5 · RUN** — `port.call` / `emit` → local | bus (по policy); live config-refs
  обновляются (opt-in).
- **6 · SHUTDOWN** (обратный порядок) — stop serving (реверс START) → abort
  in-flight (`meta.signal` → хендлеры и подписки) → `@OnDestroy` (реверс
  топосорта): close пулы, disconnect.

**Инварианты, которые кодирует схема:**

| Инвариант | Фаза |
|---|---|
| `process.env` трогается только в config | 0 |
| дискавери из дерева модулей, не глобальный registry | 1 |
| транспорты — провайдеры, не мешок в конструкторе | 1 |
| port-биндинг вычисляется из графа, не внешний конфиг | 1 |
| **`dispatch` рождается в фазе 3 ⇒ ранний `listen` невозможен** (гарантия, не конвенция) | 2→3→4 |
| fail-fast: конфиг (0) и биндинг / недостающий транспорт (1) | 0, 1 |
| `select` — единственный неснимаемо-внешний вход | 0→1 |
| START по топосорту, SHUTDOWN строго в реверсе | 4 ↔ 6 |

Ось всей защиты от «listen на `@OnInit`» — `dispatch` рождается строго между
INIT и START. Слить WIRE в ASSEMBLE нельзя: `dispatch` станет доступен слишком
рано и гарантия сломается. Порядок 2→3→4 — несущий.

---

## 2. Машинерия фич — опциональна (прогрессивное раскрытие)

Главный принцип: **приложение из одной фичи выглядит так, будто фич нет вообще.**
Каждый слой — аддитивный; нижние уровни не меняются, когда подключаешь верхние.

| Уровень | Что добавляешь | Чего ещё нет |
|---|---|---|
| **L0** | модули + транспорт | features, select, config-модуль, порты, шина |
| **L1** | типизированный config-модуль | features, select, порты, шина |
| **L2** | `makeFeature` + `select` (`--features=all\|subset`) | порты, шина — всё co-located |
| **L3** | `makeContract` + порты (co-located) | шина — in-proc dispatch |
| **L4** | NATS-транспорт + `dispatch`-policy | — split-развёртывание |

Ключевое: **код фич и эндпоинтов между L3 и L4 не меняется.** Разнесение по
процессам — это разница в composition root и конфиге, не в бизнес-коде. И L0
нигде не упоминает `feature`/`port`/`select` — за них не платишь, пока они не
нужны.

Composition root — это одна функция `assemble(...)` с опциональными полями.
Простой случай игнорирует всю машинерию:

```typescript
// сигнатура (proposed) — надстройка над сегодняшним new App({ modules, transports })
assemble({
  modules?,     // L0
  config?,      // L1  привязка источников: [[src, targets]]; env — неявный пол (kernel)
  features?,    // L2
  select?,      // L2
  transports?,  // L0+ (провайдеры транспортов; sugar регистрирует их в граф)
  plugins?,     // L1+ ambient cross-cutting (тонкий root-bag; feature-scoped инфра едет с фичей)
  dispatch?,    // L4  'local-first' | 'always-remote' | 'balanced'
}): App         // → app.run()
```

Ниже — прогрессия L0→L4 в канонической форме: **сервисы — классы,
endpoint-декларации — значения** (решение 2026-07-13, одна прогрессия вместо
двух параллельных «стилей»); формы хендлера — §5.

---

## 3. User space / kernel space

Граница между тем, что пишет пользователь, и тем, чем владеет фреймворк — как
между user space и kernel space в ОС.

- **Kernel space** (привилегированное, токены **не** экспортируются):
  `ConfigSource` (слитый слой источников), транспорты, bus / port-client
  внутренности, машинерия графа и lifecycle.
- **User space** (то, что пишешь ты): сервисы, endpoints, контракты,
  конфиг-как-данные.

Границу пересекаешь только через публичные абстракции — «системные вызовы»:

| User space хочет | «syscall» | Kernel делает |
|---|---|---|
| значение конфига | инжект `Config<typeof X>` | читает из `ConfigSource`, валидирует |
| позвать другую фичу | `Port<C>.call` / `Emitter<C>.emit` | local dispatch или транспорт |
| принять запрос | вернуть / `yield` из endpoint | сокет / subscribe |

**Enforcement — не рантайм-ACL, а видимость ES-модулей:** kernel-токены не
экспортируются, поэтому из user space их физически нечем инжектить (ideas.md,
решение 3). Границу пересекаешь только там, где фреймворк поставил дверь.

**Зачем:** user-space код провенанс-слеп и транспорт-слеп → тот же бизнес-код
работает локально или в split, с конфигом из env или vault, без правок. Kernel
поглощает окружение; user space остаётся чистым.

### Конфигурация: секции + одна центральная читалка (token-families)

Модель конфига — **конфиг как token-families, `sources`/merged-`Vars` убраны
(2026-07-08); владение и привязка пересмотрены на keys-capability (2026-07-10).**
Полная логика — [ideas.md](../decisions/ideas.md) («Kernel/user space; конфиг как
token-families» + «Конфиг: keys-capability вместо `configs:`-владения») и
[discussions/05 §15](../history/discussions/05-modular-monolith-features-ports.md).

Секция объявляется `makeConfig('prefix', schema)`: префикс строит имя ключа
(`maxItems` → `ORDERS_MAX_ITEMS`), `from('KEY')` задаёт точное имя. **Источник не
называется** — секция (user space) провенанс-слепа: читает ключ, не зная, откуда
пришло значение (syscall-граница, как чтение `fd`). Приватность — две capability
у одной секции: **токен** (право инжекта) не экспортируется из пакета — чужой
инжект невозможен синтаксически (ES-видимость, без отдельной регистрации
`configs:` и проверки владения); **`OrdersConfig.keys`** (право привязки) —
экспортируемый branded-хэндл набора ключей, инжектировать его нечем, поэтому
экспорт безопасен. Привязка в корне адресует ключи (хэндлы и глобы), а не токены —
читалка работает в своём домене.

Источники — **не провайдеры**, а объекты `ConfigSource { get; init?; close?; watch? }`
в одной приватной читалке (kernel). `env` — неявный пол; свои координаты (`path`,
`addr`) источник читает из примордиального `process.env` в `init()` (единственный
контакт с `process.env`). Привязка — в корне, плоским списком `config: [[src, targets]]`,
порядок = приоритет; **прогрессивно**: только `.env` → про конфиг в корне ничего не
пишешь.

```typescript
// секция — только схема + ключи, источник не называется
const OrdersConfig = makeConfig('orders', z.object({   // токен НЕ экспортируется из пакета
  maxItems:    z.coerce.number().default(100),   // ← ключ ORDERS_MAX_ITEMS
  databaseUrl: from('DATABASE_URL', z.url()),     // общий ключ, без префикса
}));
export const ordersKeys = OrdersConfig.keys;      // наружу — только хэндл ключей

// корень: только env → про конфиг ничего; появился второй источник → привязываешь
await assemble({
  modules: [OrdersModule],
  transports: [http()],                            // порт — из HttpConfig, не литерал
}).run();
// с vault/файлом:  config: [[vault(), [ordersKeys]], [file('config.yaml'), ['*_URL']]]
```

Жадный контейнер инстанцирует все потреблённые секции выбранных фич на `build()`
→ валидация eager → **невалидный конфиг на старте = FAIL-FAST**.

### Reloadable-конфиги

Источник с наблюдением (`reloadableFile`, `vault({ watch: true })`) на изменение
даёт читалке новое значение, и та пере-проецирует reloadable-секции: инстанс
стабилен, поля обновляются на месте. Два способа потребления:

```typescript
export const Runtime = makeConfig.reloadable('runtime', z.object({
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  rps:      z.coerce.number().default(100),
}));

// (а) read-latest — читаем при каждом использовании, подписка не нужна
@Injectable([Runtime])
class Logger {
  constructor(private cfg: Config<typeof Runtime>) {}
  debug(m: string) { if (gte(this.cfg.logLevel, 'debug')) this.write(m); }
}

// (б) react — надо перестроить ресурс при изменении
@Injectable([Runtime])
class RateLimiter {
  #bucket = new TokenBucket(100);
  constructor(private cfg: Config<typeof Runtime>) {}
  @OnStart() start(signal: AbortSignal) {
    this.#bucket.refill(this.cfg.rps);
    this.cfg.onChange(signal, (next) => this.#bucket.refill(next.rps)); // отписка по signal
  }
}

// корень: reloadable-источник — то, что вообще включает reload
await assemble({ config: [[reloadableFile('runtime.yaml'), [Runtime]]], /* ... */ }).run();
```

Две асимметрии со стартом:

- **старт: невалидный конфиг → die; reload: невалидный → keep last-good + warn.**
  Живой процесс не падает из-за плохого горячего значения.
- **вступит ли изменение в силу — ответственность потребителя.** read-latest и
  `onChange` — да; значение, захваченное один раз в конструкторе (URL пула) — нет.
  Поэтому reloadable — opt-in, только для значений, которые кто-то честно
  перечитывает или на которые реагирует.

---

## 4. Прогрессия L0–L4

### L0 — одна фича, как будто фич нет

```typescript
// orders.service.ts — сервис: класс, сам себе токен
@Injectable([])
export class OrdersService {
  create(dto: NewOrder): Order { /* ... */ }
}

// create-order.endpoint.ts — декларация: значение; словарь HTTP типизирован
export const CreateOrder = httpEndpoint({
  method: 'POST',
  path: '/orders',
  input: NewOrder,
  output: Order,
  pipeline: basePipeline,
  deps: [OrdersService],
  handle: (orders) => async (input) => new Ok(orders.create(input)),
});

// orders.module.ts
export const OrdersModule = makeModule({
  name: 'module:orders',
  providers: [OrdersService],
  endpoints: [CreateOrder],          // декларации — значения, не конструкторы
});

// main.ts — composition root
await assemble({
  modules: [OrdersModule],
  transports: [http({ port: 3000 })],
}).run();
```

Ни `feature`, ни `select`, ни `port`. `deps` — явный массив (как везде во
фреймворке); внешняя функция `handle` вызывается один раз на сборке (аналог
конструктора), замыкание — «инстанс» ручки. Endpoint — обычный узел графа с
синтетическим id (`endpoint:POST /orders`): рёбра `deps` видны в визуализации,
циклы и `strictExports` работают штатно.

Онтологически `httpEndpoint` — сахар «анонимный контракт + `implement` одним
жестом»: иерархия деклараций контракт-первична. Анонимность — нормальное
состояние L0-поверхности (никто в процессе её не зовёт); вынес контракт в
именованное значение и экспортировал — ручка стала portable (порты, клиенты,
версии) без переписывания реализации — [ideas.md [2026-07-13]](../decisions/ideas.md)
«Контракт первичен».

### L1 — + типизированный config (никакого `process.env` в коде)

Источники — в корне (kernel), секция — только схема + ключи, source-agnostic
(см. §3). `OrdersConfig` авто-дискаверится из провайдера, который его инжектит.
Декларации endpoint'ов не меняются.

```typescript
// orders.config.ts — секция: схема + ключи, БЕЗ источников
// экспорт файла ≠ экспорт пакета: из пакета наружу идёт только OrdersConfig.keys
export const OrdersConfig = makeConfig('orders', z.object({
  maxItems:    z.coerce.number().default(100),   // ← ключ ORDERS_MAX_ITEMS
  databaseUrl: from('DATABASE_URL', z.url()),     // общий ключ, без префикса
}));

// orders.service.ts — конфиг инжектится типизированным срезом
@Injectable([OrdersConfig])
export class OrdersService {
  constructor(private cfg: Config<typeof OrdersConfig>) {}
  create(dto: NewOrder): Order {
    if (dto.items.length > this.cfg.maxItems) throw Fail.badRequest('too many');
    /* ... */
  }
}

// orders.module.ts — отдельной регистрации нет: секция авто-дискаверится из инжекта
// main.ts — только env → про конфиг в корне ничего (env — неявный пол; валидация eager → FAIL-FAST)
await assemble({
  modules: [OrdersModule],
  transports: [http({ port: 3000 })],
}).run();
// появился второй источник → привязываешь: config: [[file('config.yaml'), [OrdersConfig.keys]]]
```

### L2 — + features + select (модульный монолит с выбором)

```typescript
// features.ts
export const OrdersFeature  = makeFeature({ name: 'orders',  modules: [OrdersModule] });
export const BillingFeature = makeFeature({ name: 'billing', modules: [BillingModule] });

// config.ts — select читается в bootstrap (фаза 0, до контейнера), source-agnostic
export const RootConfig = makeConfig('', z.object({
  FEATURES: z.string().default('all'), // 'all' | 'orders,billing'
}));

// main.ts — load() делает примордиальное чтение select (env, фаза 0) до контейнера
const cfg = await load(RootConfig);
await assemble({
  features: [OrdersFeature, BillingFeature],
  select: cfg.FEATURES,          // 'all' локально, 'orders' в отдельном поде
  transports: [http({ port: 3000 })],
}).run();
```

Не выбрал фичу → её провайдеры не построились (жадный контейнер), её эндпоинтов
нет (дискавери из дерева выбранных модулей). Всё ещё один процесс, шина не нужна.

### L3 — + контракт + порт (co-located, in-proc)

```typescript
// billing/contracts.ts — владеет billing, импортируют потребители
export const ChargeCard = makeContract({
  name: 'billing.charge',
  kind: 'request',                       // request-reply, Fail-able
  input:  z.object({ orderId: z.string(), amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
});

// billing — реализует контракт (декларация без транспорта: биндинг на сборке)
export const ChargeCardHandler = implement(ChargeCard, {
  deps: [PaymentGateway],
  handle: (gw) => async (input, meta) =>
    new Ok({ chargeId: await gw.charge(input, meta.signal) }),
});

// orders — потребляет порт: обычная зависимость декларации
// (не знает, локальный billing или за сетью)
export const CreateOrder = httpEndpoint({
  method: 'POST',
  path: '/orders',
  input: NewOrder,
  output: Order,
  pipeline: basePipeline,
  deps: [OrdersService, ChargeCard.port],
  handle: (orders, billing) => async (input, meta) => {
    const charge = await billing.call({ orderId: input.id, amount: input.total }, meta);
    if (charge.isFail) return charge;    // отказ — нормальный Fail, не исключение
    return new Ok(orders.create(input));
  },
});

// main.ts — не изменился с L2: биндинг порта вычисляется из графа.
// billing выбран → ChargeCard.port биндится на локальный хендлер (in-proc).
```

### L4 — + NATS + dispatch-policy (split, тот же код фич)

```typescript
// main.ts — меняется ТОЛЬКО корень и конфиг, не эндпоинты
const cfg = await load(RootConfig);      // примордиально — только select
await assemble({
  features: [OrdersFeature, BillingFeature],
  select: cfg.FEATURES,                  // 'orders' здесь, 'billing' в другом поде
  transports: [
    http(),
    nats(),                              // outbound-транспорт для портов
  ],                                     // порт/servers — из Http/NatsConfig (env: HTTP_PORT, NATS_SERVERS)
  dispatch: 'local-first',               // co-located → in-proc, иначе → NATS
}).run();
```

`select='orders'` + billing не выбран → `ChargeCard.port` биндится на remote-клиент
поверх NATS; billing в своём поде экспонирует `billing.charge` (queue-group для
реплик). `select='all'` без NATS → всё co-located, порт локальный. Один бинарник,
разные топологии — за счёт конфига.

---

## 5. Формы хендлера

Декларация всегда одна (значение); форма `handle` — свободная, симметрично
«четырём формам юнитов» пайплайна:

| Форма | Когда |
|---|---|
| `(input, meta) => …` | без зависимостей; единственная форма, которую принимают standalone-транспорты (`server.route`) — endpoint с `deps` туда не проходит по типам |
| `deps: […]` + `(…deps) => (input, meta) => …` | каррированная фабрика: внешний вызов — один раз на сборке, замыкание = инстанс |
| класс с `@Injectable` и методом `handle` | форма подключения DI (не «второй стиль» деклараций): App резолвит из контейнера — механизм классов-юнитов пайплайна |

Классовая форма эквивалентна каррированной строчка в строчку
(`@Injectable([...])` ↔ `deps:`, конструктор ↔ внешняя функция, метод ↔
замыкание) и сохраняет привычную после NestJS структуру:

```typescript
@Injectable([OrdersService, ChargeCard.port])
export class CreateOrderHandler {
  constructor(
    private orders: OrdersService,
    private billing: Port<typeof ChargeCard>,
  ) {}

  async handle(input: NewOrder, meta: { signal: AbortSignal }): Output<Order> {
    /* как в L3 выше */
  }
}

export const CreateOrder = httpEndpoint({
  method: 'POST',
  path: '/orders',
  input: NewOrder,
  output: Order,
  pipeline: basePipeline,
  handle: CreateOrderHandler,   // класс — поле типизированного вызова:
});                             // handle сверяется со схемами в точке декларации
```

Проверка типов классовой формы происходит в точке декларации (класс — поле
generic-вызова), `implements` не нужен. Unit-тест хендлера — без фреймворка:
`CreateOrder.handle(fakeOrders, stubBilling)` для каррированной формы или
`new CreateOrderHandler(fakes…)` для классовой — ноль импортов из
`@nestling/*`. Один handler на несколько транспортов = несколько тонких
деклараций, разделяющих одно значение/класс.

Прежний «функциональный стиль» (endpoint как токен + `factoryProvider`)
остаётся низкоуровневой возможностью контейнера, но из канона ушёл: три
артефакта на ручку и токен, который никто не инжектит. Логика и отвергнутые
варианты — [ideas.md [2026-07-13]](../decisions/ideas.md)
«Endpoint-декларации».

---

## Что из этого следует для реализации

- **Единая модель деклараций** (`httpEndpoint`/`cliEndpoint`/`implement`,
  `deps`, формы хендлера; удаление `@Endpoint`/`@HttpEndpoint`/`IEndpoint` и
  endpoint-registry; онтология «контракт первичен»: конструктор = анонимный
  контракт + `implement`) — roadmap 24, делать рядом с фиксом дискавери:
  глобальный реестр умирает вместе с декоратором.
- **Фикс дискавери** (эндпоинты/транспорты из дерева модулей, не из глобального
  registry) — предпосылка для L2+: без него невыбранная фича всё равно
  «протекает» в приложение. См. [roadmap](../decisions/roadmap.md).
- **`@OnStart` / go-live-фаза** — предпосылка для гарантии `dispatch` (WIRE между
  INIT и START).
- **Порты (L3/L4)** — самый большой слой; L0–L2 можно доставить раньше и
  независимо. In-proc-биндинг (L3) проверяется без NATS.
- Порядок в roadmap: config-модуль → фикс дискавери + `makeFeature`/`select` →
  `@OnStart` → `makeContract` + порты (in-proc) → `@nestling/transport.nats`.
