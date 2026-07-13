# Nestling и RxJS

> Как использовать RxJS внутри хендлеров — и почему он не нужен фреймворку.

⚠️ **Статус:** страница описывает целевой API из [decisions/ideas.md](../decisions/ideas.md)
(`compose`, `events()`, item-цепочки, `meta.signal`, `Topic`, единая модель
endpoint-деклараций [2026-07-13]). Часть этого API ещё не реализована.
При расхождении — источник истины `docs/decisions/ideas.md`.

---

## Позиция фреймворка

Nestling **не зависит от RxJS и не навязывает его**. Все стриминговые границы
фреймворка — стандартный `AsyncIterable`:

- входной стрим приходит в хендлер как `AsyncIterableIterator<T>`;
- стриминговый ответ — это `yield` из хендлера-генератора;
- источники событий (`Topic`) отдают подписку как `AsyncIterable`.

Pull-модель итераторов даёт backpressure бесплатно: медленный клиент просто
не запрашивает следующий элемент. Push-модель Observable потребовала бы
докручивать это руками — поэтому Observable на границах фреймворка нет.

При этом RxJS остаётся полностью доступным **внутри хендлера** как обычная
зависимость приложения. Мостики тривиальны в обе стороны.

## Когда брать RxJS, а когда нет

Правило (лакмус из decisions/ideas.md):

| Задача | Инструмент |
|---|---|
| Наблюдение, лимиты, таймауты, фильтрация элементов | item-цепочка на `stream()` / `events()` — Rx не нужен |
| Простая поэлементная обработка | `for await` в хендлере — Rx не нужен |
| **Окна и агрегация по времени** (`bufferTime`, `debounceTime`, `auditTime`) | RxJS в хендлере |
| **Слияние нескольких потоков** (`merge`, `combineLatest`, `zip`) | RxJS в хендлере |
| **Higher-order streams** (`switchMap`, `exhaustMap`) | RxJS в хендлере |

Если логика — про *время* или про *несколько потоков сразу*, это
dataflow-программирование: фреймворк туда не лезет, бери Rx.
Всё остальное дешевле сделать штатными средствами.

## Мостики

```typescript
import { from } from 'rxjs';                    // AsyncIterable → Observable
import { eachValueFrom } from 'rxjs-for-await'; // Observable → AsyncIterable
```

- `from(asyncIterable)` — встроен в RxJS.
- `eachValueFrom(observable$)` — из пакета
  [`rxjs-for-await`](https://github.com/benlesh/rxjs-for-await)
  (сам Observable в RxJS 7 не является async-iterable).

**Отмена сшивается автоматически:** клиент отвалился → `for await` по
выходному итератору завершается → `eachValueFrom` отписывается от
Observable → `from()` перестаёт тянуть вход. Дополнительно `meta.signal`
(AbortSignal запроса: дисконнект клиента / graceful shutdown / админский
abort подписки) закрывает подписки на источники независимо.

## Пример 1: окна по времени (хендлер без зависимостей)

Клиент льёт поток метрик (NDJSON), ответ — агрегаты по секундным окнам.
На голых итераторах «окно по времени» — это гонка таймера против
`iterator.next()`; в Rx — один оператор.

```typescript
import { bufferTime, filter, from, map } from 'rxjs';
import { eachValueFrom } from 'rxjs-for-await';
import z from 'zod';

import { stream } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { base, guardedStream } from '../infra/pipelines';

const MetricPoint = z.object({ name: z.string(), value: z.number(), ts: z.number() });
const WindowAggregate = z.object({
  count: z.number(), avg: z.number(), max: z.number(), windowEnd: z.iso.datetime(),
});
type MetricPoint = z.infer<typeof MetricPoint>;
type WindowAggregate = z.infer<typeof WindowAggregate>;

const summarize = (batch: MetricPoint[]): WindowAggregate => ({
  count: batch.length,
  avg: batch.reduce((sum, p) => sum + p.value, 0) / batch.length,
  max: Math.max(...batch.map(p => p.value)),
  windowEnd: new Date().toISOString(),
});

export const AggregateMetrics = httpEndpoint({
  method: 'POST',
  path: '/metrics/aggregate',
  input: guardedStream(MetricPoint),   // item-цепочка: лимиты/таймауты — без Rx
  output: stream(WindowAggregate),
  pipeline: base,
  handle: async function* (points: AsyncIterableIterator<MetricPoint>) {
    const aggregates$ = from(points).pipe(   // ← граница: AsyncIterable → Observable
      bufferTime(1_000),
      filter(batch => batch.length > 0),
      map(summarize),
    );
    yield* eachValueFrom(aggregates$);       // ← граница: Observable → AsyncIterable
  },
});
```

Справочно, `guardedStream` из инфраструктуры приложения:

```typescript
export const guardedStream = <S extends ZodType>(schema: S) =>
  stream(schema).limit(50_000).gapTimeout(30_000);
```

## Пример 2: слияние двух хабов (DI, класс-хендлер)

Живая лента активности: заказы и платежи из двух горячих источников,
слитые в одну SSE-подписку с троттлингом.

```typescript
// activity.model.ts
import z from 'zod';

export const ActivityEvent = z.object({
  kind: z.enum(['order', 'payment']),
  summary: z.string(),
  at: z.iso.datetime(),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export interface Order   { id: string; total: number }
export interface Payment { id: string; amount: number }
```

```typescript
// hubs.ts — горячие источники: обычные синглтоны, живут независимо от подписчиков
import { Injectable } from '@nestling/container';
import { Topic } from '@nestling/streams';

import type { Order, Payment } from './activity.model';

@Injectable([])
export class OrdersHub {
  #topic = new Topic<Order>({ buffer: 1000, onSlowConsumer: 'disconnect' });
  publish(order: Order) { this.#topic.push(order); }
  subscribe(signal: AbortSignal) { return this.#topic.subscribe(signal); }
}

@Injectable([])
export class PaymentsHub {
  #topic = new Topic<Payment>({ buffer: 1000, onSlowConsumer: 'disconnect' });
  publish(payment: Payment) { this.#topic.push(payment); }
  subscribe(signal: AbortSignal) { return this.#topic.subscribe(signal); }
}
```

```typescript
// activity-feed.endpoint.ts
import { from, map, merge, throttleTime } from 'rxjs';
import { eachValueFrom } from 'rxjs-for-await';

import { Injectable } from '@nestling/container';
import { events } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

import { ActivityEvent, type Order, type Payment } from './activity.model';
import { OrdersHub, PaymentsHub } from './hubs';
import { base } from '../../infra/pipelines';

@Injectable([OrdersHub, PaymentsHub])
export class ActivityFeedHandler {
  constructor(
    private readonly orders: OrdersHub,
    private readonly payments: PaymentsHub,
  ) {}

  async *handle(_: undefined, meta: { signal: AbortSignal }) {
    const feed$ = merge(
      from(this.orders.subscribe(meta.signal)).pipe(map(this.#orderToActivity)),
      from(this.payments.subscribe(meta.signal)).pipe(map(this.#paymentToActivity)),
    ).pipe(throttleTime(200, undefined, { leading: true, trailing: true }));

    yield* eachValueFrom(feed$);
  }

  #orderToActivity = (o: Order): ActivityEvent =>
    ({ kind: 'order', summary: `Заказ ${o.id} на ${o.total}₽`, at: new Date().toISOString() });

  #paymentToActivity = (p: Payment): ActivityEvent =>
    ({ kind: 'payment', summary: `Платёж ${p.id}: ${p.amount}₽`, at: new Date().toISOString() });
}

// декларация — значение; класс-хендлер App резолвит из контейнера
export const ActivityFeed = httpEndpoint({
  method: 'GET',
  path: '/activity/live',
  output: events(ActivityEvent).tap(e => console.debug('out:', e.kind)),
  pipeline: base,
  handle: ActivityFeedHandler,
});
```

```typescript
// module + bootstrap
import { assemble, makeModule } from '@nestling/app';
import { http } from '@nestling/transport.http';

import { ActivityFeed } from './activity-feed.endpoint';
import { OrdersHub, PaymentsHub } from './hubs';

export const ActivityModule = makeModule({
  name: 'module:activity',
  providers: [OrdersHub, PaymentsHub],
  endpoints: [ActivityFeed],           // декларации — значения
});

await assemble({
  modules: [ActivityModule],
  transports: [http({ port: 3000 })],
}).run();
```

Обрати внимание на границу скоупов, ставшую физической:

- `OrdersHub.publish()` — точка **per-published-event** (логика «один раз
  на публикацию»: счётчики публикаций, обогащение у источника);
- `handle()` — точка **per-connection**: каждый подписчик получает свой
  `merge` и свой троттлинг;
- `.tap()` на `events()` — item-цепочка per-connection (сработает по разу
  на каждого подписчика).

## Тестирование

Хендлер с Rx внутри тестируется без фреймворка:

```typescript
const handler = new ActivityFeedHandler(fakeOrdersHub, fakePaymentsHub);
const controller = new AbortController();

const events: ActivityEvent[] = [];
for await (const e of handler.handle(undefined, { signal: controller.signal })) {
  events.push(e);
  if (events.length === 3) controller.abort();
}
```

Ни транспорта, ни контейнера, ни подписок Rx в тесте — только протокол
async-итерации.

## Оговорка про backpressure

Внутри Rx-острова pull-семантика теряется: Observable пушит,
`eachValueFrom` копит непотреблённые значения в очередь. Для операторов,
которые **сжимают** поток (окна, троттлинг, дебаунс), это не проблема —
они для того и стоят. Но если протащить через Rx-остров поток
один-к-одному без сжатия, буфер может расти на медленном клиенте.

Правило: заходишь в Rx — убедись, что выходной поток не плотнее входного,
либо ограничь его (`throttleTime`, `bufferTime`, `sample`).

## Почему Rx нет в ядре (кратко)

1. Границы — стандартный протокол языка, а не библиотечный тип.
   Pull + встроенный backpressure. Iterator helpers идут в стандарт —
   фреймворк движется туда же, куда язык.
2. Словарь комбинаторов фреймворка закрытый и инфраструктурный.
   Всё, что про время и слияние потоков, — осознанно вне ядра.
3. Урок NestJS: интерцепторы, намертво прикованные к RxJS, навязывают его
   каждому пользователю — а со стримами всё равно неловко.

Подробная аргументация — в [decisions/ideas.md](../decisions/ideas.md), секция
«Не переизобретаем ли мы RxJS?».
