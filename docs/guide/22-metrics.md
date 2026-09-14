# 22. Считать запросы и вызовы между процессами

> Гайд по текущему API; сверено с кодом `6dc1ec67`.
> Целевое описание: [design/container.md](../design/container.md), раздел
> «Метрики ядра», [design/pipeline.md](../design/pipeline.md) §2 и
> [design/operations.md](../design/operations.md) §2.3. Почему так:
> запись [ideas.md](../decisions/ideas.md) «Метрика — декларация»
> [2026-09-14].

Два процесса из [главы 20](./20-split.md) работают, и записи логгера
связаны трассой. По логу видно, что произошло с одним запросом, но не
видно, сколько их было и сколько они заняли. Нужны числа: счётчик
запросов, длительность обработки и то же самое по вызовам операций между
процессами.

## Метрика объявляется значением

Группа метрик — значение, созданное `makeMetrics`. Префикс группы и ключ
записи складываются в имя метрики: `orders.created`,
`orders.checkout.duration`. Других имён не бывает.

```typescript
// src/features/orders/orders.metrics.ts
import { counter, histogram, makeMetrics, open } from '@nestlingjs/app';

export const OrdersMetrics = makeMetrics('orders', {
  created: counter({
    help: 'Созданные заказы',
    attributes: { tier: ['free', 'paid'], source: open },
  }),

  'checkout.duration': histogram({
    help: 'Время оформления',
    unit: 'ms',
    buckets: [5, 25, 100, 500, 1000],
  }),
});
```

Конструкторов два, по одному на вид. У счётчика корзин нет, у гистограммы
нет прибавки по умолчанию — расхождение проверяет компилятор в точке
объявления, а не условие в рантайме.

Ключ пишется так, как должен читаться в имени: `'checkout.duration'` —
обычный ключ объекта в кавычках. Преобразования `camelCase` в точки нет.

## Атрибут объявлен перечнем или пометкой `open`

Каждый атрибут метрики объявлен, и умолчания у объявления нет. Перечень
значений даёт два следствия: значение вне перечня не компилируется, и
ряды метрики известны как произведение перечней — ещё до первого запроса.

`open` объявляет атрибут, значения которого известны только в рантайме:
ряд заводится по факту первой записи, и нулей у него нет. Пометка — это
место, где автор метрики подписывается под тем, что количеством рядов
управляет он.

## Писателя раздаёт граф

Группа служит и объявлением, и DI-токеном: `@Component([OrdersMetrics])`
даёт писателя, у которого метрика выбирается полем.

```typescript
// src/features/orders/orders.service.ts
import type { MetricsOf } from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';

import { OrdersMetrics } from './orders.metrics.js';

@Component([OrdersMetrics])
export class OrdersService {
  constructor(private readonly metrics: MetricsOf<typeof OrdersMetrics>) {}

  create(): void {
    this.metrics.created.add({ tier: 'paid', source: 'web' });
    this.metrics['checkout.duration'].record(42);
  }
}
```

У счётчика метод `add(value?, attributes?)`, у гистограммы —
`record(value, attributes?)`. `add` без значения прибавляет единицу.
Объявленные атрибуты обязательны: без них ряд не определён. Оба метода
синхронны и возвращают `void` — запись метрики не имеет права задерживать
запрос.

Незадекларированная запись при этом невыразима: строкового имени в точке
записи не существует, лишний ключ атрибута и значение вне перечня не
компилируются.

Следствие, которое стоит знать заранее: код вне графа метрику написать не
может. Свободная функция получает писателя параметром от того, кто
объявил зависимость.

## Группа подключается вкладом `metrics:`

Поле `metrics:` есть у фичи, модуля, плагина и корня — рядом с
`endpoints:` и `providers:`:

```typescript
// src/features/orders/orders.feature.ts
export const OrdersFeature = makeFeature({
  name: 'orders',
  metrics: [OrdersMetrics],
  providers: [OrdersService],
  endpoints: [CreateOrder],
});
```

Группа, запрошенная в зависимостях, но не подключённая вкладом, — отказ
сборки, и его текст называет поле `metrics:`. Группы невыбранной фичи и
невыбранной ветки переключателя в сборку не попадают — тем же
механизмом, который убирает их провайдеры.

Из вкладов выбранного состава фаза BUILD собирает каталог: имя, вид,
описание, единицу, корзины и атрибуты каждой метрики. Каталог готов до
фазы INIT, поэтому список метрик процесса известен до того, как открылся
сокет. Две группы с одним полным именем метрики роняют сборку — текст
отказа называет обе.

## Четыре метрики, которые считает ядро

Ядро объявляет свои метрики той же группой — `KernelMetrics` с префиксом
`nestling` — и считает обработку запроса и вызов порта само, без единого
шага в пайплайне:

| Метрика | Вид | Атрибуты |
|---|---|---|
| `nestling.requests` | счётчик | `transport`, `pattern`, `outcome` |
| `nestling.request.duration` | гистограмма, мс | `transport`, `pattern`, `outcome` |
| `nestling.port.calls` | счётчик | `operation`, `kind`, `binding`, `outcome` |
| `nestling.port.duration` | гистограмма, мс | `operation`, `kind`, `binding`, `outcome` |

`outcome` принимает те же четыре значения, что видит `.finally`-шаг:
`completed`, `disconnected`, `aborted`, `failed`. `pattern` — шаблон
маршрута из декларации, а не адрес запроса: у `GET /users/:id` атрибут
один на все идентификаторы.

Значения `transport`, `pattern` и `operation` приходят из деклараций
сборки, поэтому ряды метрик ядра заведены до первого запроса. Экспозиция
свежеподнятого процесса показывает нули по каждому endpoint'у и каждому
исходу — и дашборд с нулём ошибок отличим от дашборда без данных.

`binding` принимает `local` и `remote` и отвечает на вопрос, ушёл вызов
на брокер или остался в процессе. Вызов операции, реализованной здесь же,
идёт через `dispatch` и поэтому даёт две группы записей: свою с
`binding: 'local'` и запись `nestling.requests` у endpoint'а реализации.

У endpoint'а с потоковым выходом длительность измеряет доставку целиком:
ответная фаза потока откладывается до закрытия итератора, и запись
следует за ней.

Инструментовка включена всегда, флага у неё нет: запись объявленного ряда
— прибавка по индексу, вычисленному на сборке.

## Накопленное держит ядро

`MetricsStore$` — узел графа, который есть у любого приложения. Он хранит
значения рядов и каталог, по которому они заведены:

```typescript
interface MetricsStore {
  readonly catalog: MetricsCatalog;
  snapshot(): MetricsSnapshot;
}
```

`snapshot()` отдаёт состояние всех рядов на момент вызова: имя метрики,
атрибуты ряда, значение счётчика или агрегат гистограммы, плюс описание и
единицу из объявления. Снимок — копия: записи, прошедшие после вызова,
его не меняют.

Выход один. Получатель, который отправляет числа наружу по своему
протоколу, снимает состояние по таймеру: и экспозиция Prometheus, и push
по OTLP принимают накопленные значения, а не приращения.

Настраивать в store нечего, и опции корня у него нет: плагин экспорта —
потребитель, а не выключатель.

## Экспозиция приходит пакетом

Формата экспорта ядро не знает. Текст для сборщика Prometheus даёт
отдельный пакет:

```typescript
// src/app.ts
import { prometheus } from '@nestlingjs/prometheus';

export const app = makeApp({
  features: [OrdersFeature],
  plugins: [prometheus()],
  transports: [http({ server: api })],
});
```

Плагин читает `MetricsStore$` и отдаёт экспозицию по `GET /metrics`;
адрес меняется опцией `prometheus({ path: '/internal/metrics' })`. Своего
сервера пакет не поднимает — экспозиция живёт на сокете приложения.
Endpoint помечен `detached` и скрыт из документа API: метрики снимает
сборщик, а не клиент.

Гистограмма выводится корзинами `_bucket`, суммой `_sum` и счётчиком
`_count`. Границы корзин приходят из объявления метрики, поэтому считать
их экспортёру не нужно.

## Проверка

Тест читает снимок тестового приложения, а ряд адресует членом группы:

```typescript
// src/features/orders/orders.spec.ts
await using testApp = await buildTest(app);

await testApp.call(CreateOrder, { sku: 'x' });

expect(
  testApp.metrics.counter(OrdersMetrics.members.created, { tier: 'paid' }),
).toBe(1);

expect(
  testApp.metrics.counter(KernelMetrics.members.requests, {
    outcome: 'completed',
  }),
).toBe(1);
```

`counter(...)` суммирует подходящие ряды, `histogram(...)` отдаёт агрегат
одного ряда, `snapshot()` — весь снимок. Подмена корня не нужна: записи
приложения и записи ядра лежат в одном store.

Юнит-тест класса без контейнера получает писателя от `metricsFor`:

```typescript
const orders = metricsFor(OrdersMetrics);
const service = new OrdersService(orders.metrics);

service.create();

expect(
  orders.read.counter(OrdersMetrics.members.created, { tier: 'paid' }),
).toBe(1);
```
