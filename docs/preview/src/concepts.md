[Nestling](index.html) / Основные концепции
{.crumbs}

# Основные концепции

Пять частей, из которых собрано любое приложение: endpoints, провайдеры, модули, результаты и пайплайн.
{.lead}

## Endpoints {#endpoints}

Контроллеров в Nestling нет. Базовая единица — **endpoint**: одна декларация-значение описывает один маршрут. В Nest контроллер объединяет несколько методов общим префиксом, и отдельные операции приходится искать внутри класса. Endpoint делает операцию самостоятельной единицей.

Endpoint объявляется schema-first: он описывает транспорт, паттерн, схемы входа и выхода, пайплайн и хендлер.

```ts create-order.endpoint.ts
export const CreateOrder = httpEndpoint({
  method: 'POST',
  path: '/orders',
  input: NewOrder,           // схема: валидация, типы, документация
  output: Order,
  pipeline: basePipeline,
  deps: [OrdersService],     // явный массив токенов
  handle: (orders) => async (input: NewOrder, meta): Output<Order> =>
    new Ok(orders.create(input)),
});
```

Поля декларации делятся на три группы. `method` и `path` описывают транспорт. `input`, `output` и `pipeline` описывают контракт. `deps` перечисляет зависимости явным массивом токенов. Декораторов endpoint'а и интерфейса `IEndpoint` нет: декоратор не влияет на типы, а сверка хендлера со схемами происходит в точке декларации. Второй аргумент хендлера, `meta`, содержит поля, которые накопили `.pre`-юниты пайплайна; хендлер объявляет только те, которые использует. В `meta` всегда есть `signal: AbortSignal` (см. раздел про [стриминг](fundamentals.html#streaming)).

Схемы `input` и `output` не обязаны быть на Zod: ядро принимает любой валидатор [Standard Schema](fundamentals.html#schemas) (Valibot, ArkType и другие), а модуль документации превращает те же схемы в OpenAPI.

### Один endpoint — любой транспорт

Пайплайн и хендлер не знают, откуда пришёл запрос. Транспортные поля разрешены только в декларации: у HTTP это `method` и `path`, у CLI — `command`. Схемы, пайплайн и хендлер переносятся между транспортами без правок. Каждая декларация знает свой транспорт; общего `ExecutionContext`, скрывающего транспорт, нет.

### Класс как способ подключить DI

Привычная после Nest форма «конструктор плюс метод `handle`» сохранилась. Это способ подключить зависимости, а не второй стиль деклараций: сама декларация остаётся тем же значением, `implements` не нужен. Класс-хендлер — обычный провайдер, и его регистрируют в `providers:` явно.

```ts create-order.endpoint.ts
@Injectable([OrdersService])
export class CreateOrderHandler {
  constructor(private orders: OrdersService) {}
  async handle(input: NewOrder, meta): Output<Order> {
    return new Ok(this.orders.create(input));
  }
}

export const CreateOrder = httpEndpoint({
  method: 'POST',
  path: '/orders',
  input: NewOrder,
  output: Order,
  pipeline: basePipeline,
  handle: CreateOrderHandler,   // сверка со схемами — в точке декларации
});
```

:::note Тестирование
Класс-хендлер — обычный класс. В юнит-тесте его создают напрямую: `new CreateOrderHandler(mockOrders)`, затем `handler.handle(input, { signal })`. Контейнер и транспорт не нужны.
:::

## Провайдеры и DI {#di}

Провайдер — то, что живёт в контейнере: сервис, репозиторий, источник событий, юнит пайплайна. Зависимости объявляются явным массивом токенов. Контейнер не угадывает типы по рефлексии: он читает массив и строит граф.

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

Токен — значение, которое нужно импортировать, чтобы запросить зависимость. Отсюда следует важное свойство: **ES-модули уже являются системой видимости**. Если токен не экспортирован из `index.ts` модуля, снаружи его нечем инжектировать. Поэтому Nestling не нужна рантайм-инкапсуляция модулей вроде `exports` в Nest: границы задаёт сам язык.

Токен может быть ссылкой на класс или строкой. Строковые токены типобезопасны благодаря брендированным типам:

```ts
export const ILogger = makeToken<ILoggerService>('logger');
// ILogger несёт свой тип: инжект типизирован, хотя токен — строка
```

### Три вида провайдеров

| Вид | Как объявить | Когда |
| --- | --- | --- |
| **class** | `@Injectable([deps])` на классе | Основной случай: сервисы с зависимостями. |
| **factory** | `factoryProvider(token, factory, deps)` | Функциональный стиль; когда нужен контроль над созданием. |
| **value** | `valueProvider(token, value)` | Готовый объект, константа, внешний клиент. |

### Циклов не существует

`forwardRef` в Nestling нет: циклические зависимости — ошибка сборки. Жадный контейнер строит весь граф на `build()`, вычисляет топологический порядок и при цикле падает на старте с понятной ошибкой. Скоупов `REQUEST` и `TRANSIENT` тоже нет: состояние запроса живёт в контексте пайплайна, а не в узле графа.

:::note good Параметризованные провайдеры без магии
Нужен один рецепт на много экземпляров (`ILogger('orders')`, `IQueue('emails')`)? Это [семейства токенов](fundamentals.html#config): контейнер видит все запрошенные члены семейства при сборке и создаёт их сразу. Тот же механизм лежит в основе конфигурации и [multi-injection](fundamentals.html#multi): `Family.all` инжектирует массив всех зарегистрированных членов семейства.
:::

## Модули {#modules}

Модуль в Nestling — обычный объект, а не класс. Он отмечает принадлежность провайдеров и endpoint'ов, служит единицей упаковки и даёт метаданные для графа и визуализации. Хуков модуля, методов `configure()` и вопроса о порядке `OnModuleInit` нет.

```ts orders.module.ts
export const OrdersModule = makeAppModule({
  name: 'module:orders',
  providers: [OrdersService, OrdersRepository],
  endpoints: [CreateOrderEndpoint, ListOrdersEndpoint],
});
```

### Модуль — значение, поэтому параметризация не требует ничего нового

Настраиваемый модуль — это функция, которая возвращает модуль. `DynamicModule`, `forRoot` и `forRootAsync` не нужны:

```ts
export const makeLoggingModule = (opts: { level: LogLevel }) =>
  makeAppModule({
    name: 'module:logging',
    providers: [valueProvider(LogLevel, opts.level), LoggerService],
  });

// использование:
makeLoggingModule({ level: 'debug' })
```

### Видимость через экспорты

По умолчанию видимость определяют ES-экспорты. Если нужна строгая проверка границ, включите её при сборке: `new ContainerBuilder({ strictExports: true })` сверит рёбра готового графа с полями `exports` модулей. Это проверка на `build()`, а не проверка прав во время запроса.

## Ok и Fail {#result}

Хендлер возвращает `Ok` или `Fail`. Оба — значения и часть контракта: `Output<T, E> = Promise<Ok<T> | E | T>`, где `E` — отказы из поля `errors:` декларации. `Fail` можно не только вернуть, но и бросить: `throw` здесь заменяет отсутствующий в JavaScript оператор `?` из Rust и служит ранним выходом со значением. Рантайм обрабатывает оба пути одинаково. Брошенное исключение, которое не является `Fail`, считается внутренней ошибкой: клиент получает `UnknownError` со статусом `INTERNAL_ERROR` без деталей.

```ts
async handle(input: NewOrder, meta): Output<Order, EmailTaken> {
  const existing = await this.orders.findByEmail(input.email);
  if (existing) {
    meta.fail(EmailTaken({ email: input.email })); // ранний выход; принимает только отказы из errors:
  }
  const order = await this.orders.create(input);
  return Ok.created(order, { Location: `/orders/${order.id}` });
}
```

| Успех | Отказ |
| --- | --- |
| `new Ok(value)` — или просто вернуть значение | `defineFail('CODE', { status: 'BAD_REQUEST', … })` / `'CONFLICT'` |
| `Ok.created(value, headers?)` | `'UNAUTHORIZED'` / `'FORBIDDEN'` / `'NOT_FOUND'` |
| `Ok.accepted(...)` | `'TIMEOUT'` / `'TOO_MANY_REQUESTS'` |
| `Ok.noContent()` | `'INTERNAL_ERROR'` / `'SERVICE_UNAVAILABLE'` |

Статусы семантические, а не HTTP-коды. Как ответить по сети (404 или код gRPC), решает транспорт. Кроме статуса у `Fail` есть `code` — стабильный машинный код для клиента (`'ORDER_NOT_FOUND'`) — и `cause` — исходная ошибка, если она была.

`Fail` — обычный результат. Когда endpoint вызывает другую фичу через [порт](scaling.html#ports), отказ приходит как `Fail`, который можно проверить и вернуть дальше без `try/catch`. Правило: свой отказ бросают, чужой возвращают.

```ts
const charge = await this.billing.call({ orderId, amount }, meta);
if (charge.isFail) return charge;      // отказ — обычный результат, не исключение
return new Ok(this.orders.create(input));
```

### Доменные ошибки: `defineFail`

Доменная ошибка — не подкласс с декоратором, а значение-фабрика, как `makeToken<T>()`. Идентичность ошибки задаёт её `code`, а не `instanceof`: отказ, пришедший от удалённого порта, — это десериализованные данные, у которых нет класса, а `code` сохраняется.

```ts orders/errors.ts
export const OrderNotFound = defineFail('ORDER_NOT_FOUND', {
  status: 'NOT_FOUND',
  details: z.object({ orderId: z.string() }),  // schema-first — и для ошибок
  message: (d) => `Order ${d.orderId} not found`,   // сообщение строится из деталей
});

throw OrderNotFound({ orderId: '42' });
throw OrderNotFound({ orderId: '42' }, { cause: dbError });

// в .catch-юните — сопоставление по code, работает и после сети:
if (OrderNotFound.is(res)) { /* ... */ }
```

### Ошибки — часть контракта

Endpoint объявляет свои отказы: `errors: [EmailTaken, OrderLimitReached]`. Из этого списка строятся ответы в OpenAPI, а потребители порта знают, какие `Fail` ожидать. Гарантия держится на двух уровнях. Компилятор не даёт вернуть отказ вне списка. Выход из пайплайна заменяет всё незадекларированное на `UnknownError`. Поэтому ответ endpoint'а — закрытое множество `E ∪ UnknownError`.

```ts
export const CreateOrder = httpEndpoint({
  method: 'POST',
  path: '/orders',
  input: NewOrder, output: Order,
  errors: [EmailTaken, OrderLimitReached],
  deps: [OrdersService],
  handle: (orders) => async (input: NewOrder, meta): Output<Order, EmailTaken | OrderLimitReached> => {
    if (await orders.emailBusy(input.email)) {
      meta.fail(EmailTaken(input.email));  // типизированный ранний выход: только отказы из errors
    }
    return Ok.created(await orders.create(input));
  },
});
```

Компилятор проверяет всё, что передаётся значениями: возвраты через `Output<T, E>` (в том числе проброс отказа порта — чужой `Fail` не попадёт в ответ, пока не задекларирован) и ранние выходы через `meta.fail(e): never`, который принимает только задекларированные отказы. `meta.fail` — второй зарезервированный ключ `meta` после `signal`; его тип выводится из декларации endpoint'а. Всё, чего компилятор не видит (прямой `throw`, отказ из глубины сервисов), проверяет выход из пайплайна: незадекларированный отказ превращается в `UnknownError` (`code: 'UNKNOWN'`, статус `INTERNAL_ERROR`, общее тело ответа и `requestId`; оригинал целиком уходит в диагностический хук). Клиент видит либо задекларированный отказ, либо `UnknownError`, который неявно входит в каждый контракт (ответ `default` в OpenAPI).

Эта проверка срабатывает после всех `.catch`-юнитов: `.catch` — то место, где доменный отказ из глубины превращается в контрактный. Если отказ задекларирован, он уйдёт как есть; если забыт, клиент получит `UnknownError`, а не случайный ответ, на который он мог бы опереться.

Поэтому отдельной подсистемы exception filters в Nestling нет: централизованное преобразование ошибок — обычный `.catch`-юнит пайплайна.

## Pipeline {#pipeline}

Здесь Nestling сильнее всего отличается от Nest. Вместо middleware, interceptors, guards, pipes и exception filters — один механизм: пайплайн с плоскими фазами. Без `next()`, вложенных обёрток и скрытого потока управления.

### Четыре фазы, читаются сверху вниз

Один вызов `makePipeline()` определяет один слой. Декларация читается сверху вниз как план исполнения:

| Метод | Когда вызывается | Контекст |
| --- | --- | --- |
| `.pre(u)` | до хендлера, по порядку объявления | накопленный, полный |
| `.ok(u)` | ответ — успех | полный: успех означает, что все `.pre` прошли |
| `.catch(u)` | ответ — `Fail` | свой слой `Partial` |
| `.finally(u)` | всегда, последним, с исходом | `Partial` и `outcome` |

После хендлера юниты `.ok` и `.catch` выполняются в порядке объявления. Перед каждым юнитом рантайм смотрит на текущий ответ: для успеха выполняются `.ok`-юниты, для ошибки — `.catch`-юниты. Если `.ok`-юнит бросил исключение, ответ становится ошибкой, и дальше срабатывают `.catch`-юниты. `.finally` выполняется всегда и последним. Имена методов повторяют Promise: `ok`, `catch`, `finally`.

:::note Почему у `.catch` контекст Partial, а у `.ok` — полный
Успех приходит только из хендлера, а хендлер запускается только после всех `.pre`-юнитов. Поэтому `.ok` всегда получает полный контекст. `Fail` может возникнуть посреди `.pre`-фазы: если из трёх `.pre`-юнитов упал второй, исполнение сразу переходит к ответной фазе, и контекст третьего юнита не заполнен. `.catch` вызывается и в этом случае, поэтому его тип описывает свой слой как `Partial`. Контекст внешних слоёв при этом полный: слой выполняется только после того, как прошли `.pre` всех внешних слоёв.
:::

`.pre`-юнит — функция, которая добавляет типизированные данные в контекст. Контекст только растёт: поля не удаляются и не меняют тип. Это замена guards, pipes и валидации в Nest: каждый шаг дополняет контекст, и типы это отслеживают.

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

:::note Почему не модель middleware с `next()`
Модель `(ctx, next)` из Koa и Express прячет поток управления: `next` можно не вызвать, вызвать дважды или проглотить ошибку. Она ломает типизированное накопление контекста и делает цепочку неанализируемой. Плоские фазы описывают контекст прямо в типах: на пути успеха контекст полный, на пути ошибки — `Partial`. Транзакция здесь — не обёртка, а три явных юнита: `.pre` открывает, `.ok` подтверждает, `.catch` откатывает.
:::

### Композиция слоями

Пайплайны переиспользуются как неизменяемые значения. Слои складываются функцией `compose(outer, ..., inner)` и читаются снаружи внутрь. Требования слоя к внешнему контексту объявляются в типе и проверяются компилятором в точке композиции:

```ts common/pipelines.ts
export const base = makePipeline()
  .pre(withRequestId())
  .finally(audit);

// слой, которому НУЖЕН identity из внешнего слоя, объявляет это в типе:
export const authed = makePipeline<{ identity: User }>()
  .pre(requireRole('admin'));

export const adminPipeline = compose(base, withIdentity, authed);
//                                    ^ компилятор проверит, что identity будет
```

Диагностика типов — часть API. При нарушении требований тип параметра сворачивается в читаемый литерал `{ __error: '…'; missing: { identity: User } }`, где `missing` перечисляет недостающие поля и их типы. Тексты диагностик зафиксированы snapshot-тестами; у стоимости вычисления типов есть бюджет с порогом в CI.

Пайплайн привязывается только к endpoint'у. Глобальных и модульных пайплайнов нет: что подключено к endpoint'у, видно в его декларации, а композиция константами проверяется компилятором.

### Границы: пайплайн и транспорт

Ответные юниты (`.ok`, `.catch`) не меняют тип `value`: иначе схема `output` перестала бы описывать то, что уходит в сеть. Сжатие, CORS, content negotiation, общий конверт `{ data, meta }` — работа транспорта, который имеет дело с байтами, а не юнитов пайплайна. Это правило отвечает на большинство вопросов «куда положить X».

:::note good pipeline.explain()
Пайплайн можно проинспектировать: `pipeline.explain()` печатает план исполнения — дерево фаз и слоёв с аннотациями в точках композиции. Тот же механизм служит отладке, документации и визуализации графа.
:::
