# 22. Считать запросы и вызовы между процессами

> Гайд по текущему API; сверено с кодом `648a64dc`.
> Целевое описание: [design/container.md](../design/container.md), раздел
> «Метрики ядра», [design/pipeline.md](../design/pipeline.md) §2 и
> [design/operations.md](../design/operations.md) §2.3. Почему так:
> запись [ideas.md](../decisions/ideas.md) «Разбор обзоров d/10 и d/13»
> [2026-09-12], пункт 2.

Два процесса из [главы 20](./20-split.md) работают, и записи логгера
связаны трассой. По логу видно, что произошло с одним запросом, но не
видно, сколько их было и сколько они заняли. Нужны числа: счётчик
запросов, длительность обработки и то же самое по вызовам операций между
процессами.

## Интерфейс метрик

`Metrics` — интерфейс, через который пишут и ядро, и приложение. Методов
два:

```typescript
type MetricAttributes = Record<string, string | number | boolean>;

interface Metrics {
  counter(name: string, value?: number, attributes?: MetricAttributes): void;
  histogram(name: string, value: number, attributes?: MetricAttributes): void;
}
```

`counter` увеличивает счётчик, `counter` без значения — на единицу.
`histogram` добавляет наблюдение: длительность, размер тела, число
элементов. Оба метода синхронны и возвращают `void`: запись метрики не
имеет права задерживать запрос.

Объекта-инструмента у интерфейса нет. Ядро называет метрику именем, а
как их хранить, решает реализация.

## Реализация приходит опцией корня

Пока реализация не задана, записи никуда не уходят: под корневым
DI-токеном `RootMetrics$` стоит пустая реализация. Сервис пишет метрику и
собирается без всякой настройки — как логгер, который пишет в `stderr`,
пока не подключили библиотеку.

Реализацию задаёт опция `metrics` корня:

```typescript
// src/app.ts
export function declareApp(options: DeclareOptions = {}): App {
  const exporter = prometheusExporter();

  return makeApp({
    features: [UsersFeature, NotificationsFeature],
    plugins: [metricsPlugin(exporter)],
    transports: [nats({ ...options.nats, name: 'events' }), http()],
    intercom: 'events',
    metrics: exporter,
  });
}
```

Значение готовое, как у опции `logger`. Второго способа задать корень
нет: провайдер под `RootMetrics$` в `providers:` — ошибка сборки, и её
текст называет опцию `metrics`.

Опция включает и инструментовку ядра. Без неё рантайм не снимает время и
не вызывает методы записи вовсе, поэтому приложение, которому метрики не
нужны, за них не платит.

## Четыре метрики, которые считает ядро

Ядро считает обработку запроса и вызов порта само, без единого шага в
пайплайне:

| Метрика | Вид | Атрибуты |
|---|---|---|
| `nestling.requests` | счётчик | `transport`, `pattern`, `outcome` |
| `nestling.request.duration` | гистограмма, мс | `transport`, `pattern`, `outcome` |
| `nestling.port.calls` | счётчик | `operation`, `kind`, `binding`, `outcome` |
| `nestling.port.duration` | гистограмма, мс | `operation`, `kind`, `binding`, `outcome` |

`outcome` принимает те же четыре значения, что видит `.finally`-шаг:
`completed`, `disconnected`, `aborted`, `failed`. `pattern` — шаблон
маршрута из декларации, а не адрес запроса: у `GET /users/:id` атрибут
один на все идентификаторы. Так количество рядов у экспортёра остаётся
конечным и не растёт от трафика.

`binding` принимает `local` и `remote` и отвечает на вопрос, ушёл вызов
на брокер или остался в процессе. Вызов операции, реализованной здесь же,
идёт через `dispatch` и поэтому даёт две группы записей: свою с
`binding: 'local'` и запись `nestling.requests` у endpoint'а реализации.
Считая запросы, атрибут `binding` их разделяет.

У endpoint'а с потоковым выходом длительность измеряет доставку целиком:
ответная фаза потока откладывается до закрытия итератора, и запись
следует за ней.

## Записи приложения

Сервису метрики приходят как обычная зависимость — токеном семейства
`Metrics$`:

```typescript
@Component([Metrics$.auto])
export class OrdersService {
  constructor(private readonly metrics: Metrics) {}

  create(): void {
    this.metrics.counter('orders.created');
  }
}
```

`Metrics$.auto` даёт член по имени класса, и к каждой записи добавляется
атрибут `scope: 'OrdersService'`. Нужно другое имя области —
`Metrics$('orders')`.

## Адаптер и endpoint `/metrics`

Куда уходят числа, ядро не знает: формата экспорта у него нет. Адаптер
пишет приложение — им и проверяется, что публичной границы ядра
хватает.

```typescript
// src/metrics.ts
export interface MetricsExporter extends Metrics {
  render(): string;
}

export function prometheusExporter(): MetricsExporter {
  const counters = new Map<string, number>();
  const histograms = new Map<string, { count: number; sum: number }>();

  return {
    counter: (name, value = 1, attributes = {}) => {
      const key = keyOf(name, attributes);

      counters.set(key, (counters.get(key) ?? 0) + value);
    },
    // histogram и render — там же
  };
}
```

Адаптер уходит в два места сразу: опцией `metrics` он становится корнем,
а провайдером плагина — узлом графа, который читает endpoint `/metrics`.

```typescript
// src/metrics.ts (фрагмент)
export function metricsPlugin(exporter: MetricsExporter): Plugin {
  @Handler([MetricsExporter$])
  class MetricsHandler {
    constructor(private readonly exporter: MetricsExporter) {}

    async handle() {
      return new Ok(this.exporter.render());
    }
  }

  return makePlugin({
    name: 'metrics',
    providers: [valueProvider(MetricsExporter$, exporter)],
    endpoints: [
      httpEndpoint.get('/metrics', {
        output: 'text',
        detached: 'metrics scrape: not part of the application API',
        handler: MetricsHandler,
      }),
    ],
  });
}
```

Плагин, а не фича: метрики нужны в каждом процессе развёртывания, и
выбор фич их не касается. `detached` выводит endpoint из-под политик
сборки: метрики снимает сборщик, а не клиент API.

Гистограмма выражена парой `_count` и `_sum`: корзин ядро не задаёт.
Настоящему экспортёру корзины нужны, и он заведёт их у себя — интерфейс
ядра этому не мешает.

## Проверка

```typescript
// src/metrics.spec.ts
it('обработка операции попадает в экспорт счётчиком и длительностью', async () => {
  const exporter = prometheusExporter();
  const plugin = metricsPlugin(exporter);

  const observed = makeApp({
    features: [UsersFeature, NotificationsFeature],
    plugins: [plugin],
    transports: [http()],
    metrics: exporter,
  });

  await using testApp = await buildTest(observed, { args: 'all' });

  await testApp.emit(RegisterUser, { email: 'alice@example.com' });

  const text = exporter.render();

  expect(text).toContain('nestling_requests{');
  expect(text).toMatch(/nestling_port_calls\{[^}]*binding="local"/);
});
```

Тесту, которому нужны записи, а не текст, `@nestlingjs/testing` даёт
`spyMetrics()`:

```typescript
const spy = spyMetrics();
await using testApp = await buildTest(app, {
  overrides: [[RootMetrics$, spy.metrics]],
});

await testApp.call(GetUser, { id: '1' });

expect(spy.records).toContainEqual(
  expect.objectContaining({ name: 'nestling.requests' }),
);
```

Подмена корня делает две вещи сразу: перехватывает записи всех членов
`Metrics$` и включает инструментовку ядра, потому что под корнем
оказывается не пустая реализация.
