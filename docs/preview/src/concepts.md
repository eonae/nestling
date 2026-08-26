[Nestling](index.html) / Основные концепции
{.crumbs}

# Основные концепции

Пять кирпичей, из которых собрано любое приложение: endpoints, провайдеры, модули, результаты и pipeline.
{.lead}

## Endpoints {#endpoints}

В Nestling нет контроллеров. Базовая единица — **endpoint**: один класс (или одно значение) = один маршрут. Это осознанное решение: контроллер в Nest — это мешок методов с общим префиксом, где реальные единицы (отдельные ручки) размазаны по методам. Endpoint делает единицу явной.

Endpoint — **schema-first**. Он декларирует контракт: транспорт, паттерн, схему входа и выхода, пайплайн и хендлер.

```ts create-order.endpoint.ts
@Injectable([OrdersService])
@HttpEndpoint('POST', '/orders', {
  input: NewOrder,           // схема: валидация + типы + доки
  output: Order,
  pipeline: basePipeline,
})
export class CreateOrderEndpoint implements IEndpoint {
  constructor(private orders: OrdersService) {}

  async handle(input: NewOrder, meta): Output<Order> {
    return new Ok(this.orders.create(input));
  }
}
```

Два декоратора делят ответственность честно: `@Injectable` объявляет **зависимости** (явным массивом токенов), `@HttpEndpoint` — **контракт** (маршрут, схемы, пайплайн). Второй аргумент хендлера, `meta`, — это поля, которые накопили `.pre`-юниты пайплайна; хендлер декларирует только то, что использует. В `meta` всегда есть `signal: AbortSignal` — об этом в разделе про стриминг.

Схемы `input`/`output` — не обязательно Zod: ядро принимает любой [Standard Schema](fundamentals.html#schemas)-валидатор (Valibot, ArkType, …), а модуль документации превращает те же схемы в OpenAPI.

### Один endpoint — любой транспорт

Endpoint не знает, откуда пришёл запрос. Тот же контракт работает на HTTP (`pattern: 'POST /orders'`), на CLI (`pattern` = имя команды) и на шине сообщений. Меняется только строка `transport`. Это следствие принципа «pipeline оперирует значениями»: транспорт превращает провод в `RequestContext`, дальше endpoint работает с абстрактной моделью.

### Функциональный стиль

Тот же endpoint без классов — `makeEndpoint` возвращает обычное значение, зависимости замыкаются фабрикой:

```ts create-order.ts
export const makeCreateOrder = (orders: Infer<typeof OrdersService>) =>
  makeEndpoint({
    transport: 'http',
    pattern: 'POST /orders',
    input: NewOrder,
    output: Order,
    pipeline: basePipeline,
    handle: async (input: NewOrder) => new Ok(orders.create(input)),
  });
```

:::note Тестирование
DI не мешает тестам: классовый endpoint — обычный класс. `new CreateOrderEndpoint(mockOrders)`, затем `endpoint.handle(input, { signal })`. Ни контейнера, ни транспорта.
:::

## Провайдеры и DI {#di}

Провайдер — то, что живёт в контейнере: сервис, репозиторий, источник событий, юнит пайплайна. Зависимости объявляются **явным массивом токенов** — это сердце принципа «no runtime magic». Контейнер не угадывает типы по рефлексии; он читает массив и строит граф.

```ts orders.service.ts
@Injectable([ILogger, OrdersRepository])
export class OrdersService {
  constructor(
    private logger: ILoggerService,
    private repo: OrdersRepository,
  ) {}

  create(dto: NewOrder): Order { /* ... */ }
}
```

### Токены, а не имена

Токен — это значение, которое нужно **импортировать**, чтобы что-то запросить. Здесь прячется тонкое, но важное свойство: **ES-модули уже являются системой видимости**. Не экспортировал токен из `index.ts` модуля — снаружи его физически нечем инжектить. Поэтому Nestling *не нужна* рантайм-инкапсуляция модулей (нестовские `exports`): границы обеспечивает сам язык.

Токены могут быть ссылкой на класс или строкой — но благодаря branded-типам строковые токены типобезопасны:

```ts
export const ILogger = token<ILoggerService>('logger');
// ILogger несёт свой тип — инжект типизирован, даже будучи строкой
```

### Три вида провайдеров

| Вид | Как объявить | Когда |
| --- | --- | --- |
| **class** | `@Injectable([deps])` на классе | Основной случай: сервисы с зависимостями. |
| **factory** | `factoryProvider(token, factory, deps)` | Функциональный стиль; когда нужен контроль над созданием. |
| **value** | `valueProvider(token, value)` | Готовый объект, константа, внешний клиент. |

### Циклов не существует

В Nestling нет `forwardRef` — и это не упущение, а позиция: циклические зависимости **не должны существовать**. Жадный контейнер строит весь граф на `build()`, топологически сортирует его и на цикле падает *на старте* с понятной ошибкой. Нет `REQUEST`/`TRANSIENT` скоупов: request-состояние — это контекст пайплайна, а не узел графа (иначе request-scope «заражает» весь граф, как в Nest).

:::note good Параметризованные провайдеры без магии
Нужен один рецепт на много инстансов (`ILogger('orders')`, `IQueue('emails')`)? Это [token families](fundamentals.html#config) — билдер видит все запрошенные члены семейства статически и создаёт их жадно. «Динамика» происходит на сборке, а не на запросе. Тот же механизм питает конфигурацию — и [multi-injection](fundamentals.html#multi): `Family.all` инжектит массив всех зарегистрированных членов семейства.
:::

## Модули {#modules}

Модуль в Nestling — **plain object**, а не класс. Это метка принадлежности + единица упаковки (провайдеры, endpoints) + метаданные для графа и визуализации. Никаких хуков модуля, `configure()`-методов, неясного порядка `OnModuleInit`.

```ts orders.module.ts
export const OrdersModule = makeAppModule({
  name: 'module:orders',
  providers: [OrdersService, OrdersRepository],
  endpoints: [CreateOrderEndpoint, ListOrdersEndpoint],
});
```

### Модуль — значение, значит параметризация бесплатна

Раз модуль — это значение, то «настраиваемый модуль» — просто функция, которая возвращает модуль. Вся нестовская махина `DynamicModule` / `forRoot` / `forRootAsync` исчезает:

```ts
export const makeLoggingModule = (opts: { level: LogLevel }) =>
  makeAppModule({
    name: 'module:logging',
    providers: [valueProvider(LogLevel, opts.level), LoggerService],
  });

// использование:
makeLoggingModule({ level: 'debug' })
```

### Видимость — через экспорты, не через рантайм

По умолчанию видимость определяют ES-экспорты. Хочешь строгую проверку границ — включи build-time lint: `new ContainerBuilder({ strictExports: true })` сверит рёбра готового графа против деклараций `exports`. Это проверка на `build()`, а не рантайм-ACL — граф уже построен, проверка дешёвая.

## Ok и Fail {#result}

Результат хендлера — `Ok` или `Fail`, и оба — **значения**, часть контракта: `Output<T> = Promise<Ok<T> | Fail | T>`. При этом `Fail` можно не только вернуть, но и бросить: в JS нет `?`-оператора Rust'а, поэтому `throw` — легальный *ранний выход* со значением, а не «исключительная ситуация». Рантайм не различает пути. А вот брошенный *не*-`Fail` — это баг: клиент получит `UnknownError` (`INTERNAL_ERROR`) без деталей.

```ts
async handle(input: NewOrder): Output<Order> {
  const existing = await this.orders.findByEmail(input.email);
  if (existing) {
    throw Fail.conflict('Email already taken', { field: 'email' }); // свой отказ — ранний выход
  }
  const order = await this.orders.create(input);
  return Ok.created(order, { Location: `/orders/${order.id}` });
}
```

| Успех | Провал |
| --- | --- |
| `new Ok(value)` — или просто вернуть значение | `Fail.badRequest(msg, details?)` / `conflict(...)` |
| `Ok.created(value, headers?)` | `Fail.unauthorized(...)` / `forbidden(...)` / `notFound(...)` |
| `Ok.accepted(...)` | `Fail.timeout(...)` / `tooManyRequests(...)` |
| `Ok.noContent()` | `Fail.internalError(...)` / `serviceUnavailable(...)` |

Статусы — **семантические**, а не HTTP-коды: как ответить на провод (404 или gRPC-код) — решает транспорт. Помимо статуса, у `Fail` есть `code` — стабильный машинный код для клиента (`'ORDER_NOT_FOUND'`) — и `cause` — обёрнутая исходная ошибка.

`Fail` — это **нормальный результат**. Когда один endpoint зовёт другую фичу через [порт](scaling.html#ports), отказ приходит как `Fail`, который можно проверить и вернуть дальше — без `try/catch`. Правило простое: **свой отказ — `throw`, чужой — `return`**:

```ts
const charge = await this.billing.call({ orderId, amount }, meta);
if (charge.isFail) return charge;      // отказ — обычный поток, не исключение
return new Ok(this.orders.create(input));
```

### Доменные ошибки: defineFail

Доменная ошибка — не подкласс с декоратором, а **значение-фабрика**, в духе `token<T>()`. Идентичность ошибки — её `code`, а не `instanceof`: отказ, приехавший от remote-порта, — десериализованные данные, класс на них мёртв, code выживает.

```ts orders/errors.ts
export const OrderNotFound = defineFail('ORDER_NOT_FOUND', {
  status: 'NOT_FOUND',
  message: (id: string) => `Order ${id} not found`,
  details: z.object({ orderId: z.string() }),  // schema-first — и для ошибок
});

throw OrderNotFound('42');

// в .catch-юните — матчинг по code, работает и после провода:
if (OrderNotFound.is(res)) { /* ... */ }
```

### Ошибки — часть контракта

Endpoint декларирует свои отказы: `errors: [EmailTaken, OrderLimitReached]`. Из этого — OpenAPI-доки бесплатно, а потребители порта знают, какие `Fail` ждать.

```ts
@HttpEndpoint('POST', '/orders', {
  input: NewOrder, output: Order,
  errors: [EmailTaken, OrderLimitReached],
})
export class CreateOrderEndpoint implements IEndpoint {
  async handle(input: NewOrder, meta): Output<Order, EmailTaken | OrderLimitReached> {
    if (await this.orders.emailBusy(input.email)) {
      meta.fail(EmailTaken(input.email));  // типизированный ранний выход: только из errors
    }
    return Ok.created(await this.orders.create(input));
  }
}
```

Декларация — **закрытое множество**, и охраняется она на двух уровнях. **Компилятор** проверяет всё, что течёт *значениями*: возвраты — через `Output<T, E>` (в том числе проброс отказа порта: чужой `Fail` не пролезет в ответ, пока не задекларирован), ранние выходы — через `meta.fail(e): never`, бросатель, принимающий *только* задекларированные отказы. Это второй зарезервированный ключ `meta`, как `signal`: его тип рождается из декларации endpoint'а. А всё, что компилятору невидимо — прямой `throw`, отказ из глубины сервисов (`throw` в TypeScript нетипизируем: checked exceptions в языке нет), — **нормализует граница пайплайна**: незадекларированный отказ превращается в `UnknownError` (`code: 'UNKNOWN'`, статус `INTERNAL_ERROR`, generic-тело + `requestId`; оригинал — целиком в лог). Итого клиент видит либо задекларированный отказ, либо `UnknownError` — он неявно входит в каждый контракт (default-ответ в OpenAPI). Третьего не бывает.

Нормализация срабатывает *после* всех `.catch`-юнитов: `.catch` — и есть легальное место, где доменный отказ из глубины превращается в контрактный. Задекларировал — уйдёт как есть; забыл — клиент получит `UnknownError`, а не случайно «работающий» ответ, на который он успеет опереться.

Именно поэтому в Nestling нет отдельной подсистемы «exception filters»: централизованный маппинг ошибок — это обычный `.catch`-юнит пайплайна, о котором ниже.

## Pipeline {#pipeline}

Здесь Nestling резче всего расходится с Nest. Вместо middleware, interceptors, guards, pipes и exception filters — **один механизм**: pipeline с плоскими фазами. Ни `next()`, ни «луковицы», ни скрытого control flow.

### Четыре фазы, читаются сверху вниз

Один вызов `makePipeline()` определяет один слой. Декларация читается сверху вниз как план исполнения:

| Метод | Когда вызывается | Контекст |
| --- | --- | --- |
| `.pre(u)` | до хендлера, по порядку объявления | накопленный, полный |
| `.ok(u)` | ответ — успех | **полный** (успех ⇒ весь pre-тракт прошёл) |
| `.catch(u)` | ответ — `Fail` | свой слой `Partial` |
| `.finally(u)` | всегда, последним, с исходом | `Partial` + `outcome` |

Порядок на ответном тракте: `.ok`- и `.catch`-юниты исполняются **в порядке объявления**, каждый — по применимости к *текущему* ответу (если `.ok`-юнит бросил, ответ стал ошибкой — последующие `.catch` применимы). `.finally` — всегда и строго последним. Словарь намеренно повторяет Promise: `ok` / `catch` / `finally`.

:::note Почему у .catch контекст Partial, а у .ok — полный
Успех приходит только из хендлера, а хендлер запускается, только если **весь** pre-тракт прошёл — поэтому `.ok` получает железную гарантию полного контекста. А `Fail` может родиться посреди pre-тракта: если из трёх `.pre`-юнитов упал второй, исполнение сразу уходит в ответную фазу, и контекст третьего просто не успел накопиться. `.catch` вызывается и в этом случае — значит, его тип обязан честно покрывать худший вариант: свой слой `Partial`. Внешние слои при этом всегда полные: слой вообще исполняется, только если pre всех внешних слоёв уже прошли.
:::

`.pre`-юнит — функция, **монотонно** добавляющая типизированные данные в контекст. Это и есть замена guards/pipes/валидации Nest: каждый шаг наращивает контекст, и типы это отслеживают.

```ts
export const withTiming: PreUnitFn<EmptyInput, { startedAt: number }> =
  async () => ({ startedAt: Date.now() });

const pipeline = makePipeline()
  .pre(withRequestId())      // + { requestId }
  .pre(withIdentity())       // + { identity }  — «guard» это просто pre
  .pre(validate())           // + типизированный payload
  .catch(mapDomainErrors)    // «exception filter» это просто catch
  .finally(audit);           // наблюдатель исхода
```

:::note Почему не «луковица» с next()
Koa/Express-модель `(ctx, next)` отвергнута сознательно: она прячет control flow (можно не вызвать `next`, вызвать дважды, проглотить ошибку), ломает типизированное накопление контекста и делает цепочку неанализируемой. Плоские фазы говорят правду прямо в типах: на успешном тракте контекст полный, на ответном (где `.pre` мог не отработать) — `Partial`. «Транзакция» — это не обёртка, а три явные строки: `.pre` + `.ok` + `.catch`.
:::

### Композиция слоями — константами

Пайплайны переиспользуются как иммутабельные значения. Слои складываются `compose(outer, ..., inner)` — читается «снаружи внутрь». Требования слоя к внешнему контексту объявляются в типе и **проверяются компилятором в точке композиции**:

```ts common/pipelines.ts
export const base = makePipeline()
  .pre(withRequestId())
  .finally(audit);

// слой, которому НУЖЕН identity из внешнего слоя — заявляет это в типе:
export const authed = makePipeline<{ identity: User }>()
  .pre(requireRole('admin'));

export const adminPipeline = compose(base, withIdentity, authed);
//                                    ^ компилятор проверит, что identity будет
```

Привязка пайплайна — **только к endpoint'у**. Глобальных и модульных пайплайнов нет: отложенная сборка проверяется лишь на старте, а жадная композиция константами — компилятором. Что навешано на ручку, видно прямо в её декларации.

### Границы: pipeline ≠ транспорт

Ответные юниты (`.ok/.catch`) **не меняют тип value** — иначе output-схема перестанет описывать провод, и schema-first сломается. Сжатие, CORS, content-negotiation, глобальный конверт `{data, meta}` — это **транспорт** (он про байты), а не юниты пайплайна. Эта линия сама отвечает на половину вопросов «куда положить X».

А retry и timeout? Это не обёртки вокруг хендлера, а **декларативные опции endpoint'а** (`timeout: 5000`, `retry: {...}`), которые исполняет оркестратор. Декларативно = видно в метаданных = попадает в доки и визуализацию.

:::note good pipeline.explain()
Пайплайн интроспектируем: `pipeline.explain()` печатает план исполнения — дерево фаз и слоёв с аннотациями (`→ {identity: User}` в точке композиции). Один и тот же интроспективный механизм служит отладке, документации и визуализации графа.
:::
