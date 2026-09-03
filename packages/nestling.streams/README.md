# @nestling/streams

Примитивы потоков для Nestling: `Topic<T>` (источник событий с любым числом
подписчиков), комбинаторы item-цепочек (`tap`, `filter`, `limit`,
`gapTimeout`, `throttle`, `batch`, `through`) и помощники итерации под
`AbortSignal`.

> 🚧 Пакет в активной разработке, API может меняться. Целевой дизайн —
> [`docs/design/streaming.md`](../../docs/design/streaming.md).

У пакета нет зависимостей, в том числе на `@nestling/pipeline`. На нём
построены `reloadable`-секции [`@nestling/config`](../nestling.config)
(подписка `onChange(signal, cb)` — это подписка на `Topic`) и in-process
шина [`@nestling/ports`](../nestling.ports).

## Установка

```bash
npm install @nestling/streams
```

## Минимальный пример

```typescript
import { Topic } from '@nestling/streams';

class ActivityHub {
  readonly #topic = new Topic<ActivityEvent>({ buffer: 256 });

  publish(event: ActivityEvent): void {
    this.#topic.push(event);          // не ждёт потребителей
  }

  subscribe(signal?: AbortSignal): AsyncIterableIterator<ActivityEvent> {
    return this.#topic.subscribe(signal);
  }
}
```

Источник событий — обычный провайдер-синглтон. Отдельного вида endpoint'а
или регистрации для него нет.

## Границы пакета говорят на `AsyncIterable`

Всё в пакете использует стандартный протокол языка. Своего типа `Stream`,
`Observable` или моста между ними нет. Подписка — это
`AsyncIterableIterator<T>`; комбинатор — функция из `AsyncIterable` в
`AsyncIterable`.

## `Topic<T>`

`new Topic<T>(options?)` создаёт тему. Опции:

| Опция | Значение |
|---|---|
| `buffer` | размер буфера на одного подписчика, по умолчанию 1024. `0` отключает буферизацию: событие получает только тот, кто уже ждёт `next()` |
| `onSlowConsumer` | что делать при переполнении буфера подписчика: `'drop-oldest'` (по умолчанию) или `'disconnect'` |

Члены темы:

| Член | Что делает |
|---|---|
| `push(value)` | публикует событие; возвращается сразу при любом числе подписчиков, включая ноль |
| `subscribe(signal?)` | возвращает `AsyncIterableIterator<T>`; подписка завершается по `signal`, по `close()` темы и когда потребитель выходит из итерации |
| `close()` | завершает все подписки нормально, без ошибки; последующие `push` ничего не делают |
| `subscribers` | число живых подписок |
| `dropped` | сколько событий потеряно из-за переполнения буферов |
| `closed` | вызывался ли `close()` |

Буфер заведён на каждого подписчика отдельно. Когда буфер переполняется,
срабатывает `onSlowConsumer`:

- `drop-oldest` — самое старое событие этого подписчика выбрасывается,
  `dropped` растёт, подписка продолжает работать;
- `disconnect` — эта подписка завершается, остальные не затронуты.

`push` никогда не ждёт потребителей. Завершение подписки освобождает её
буфер и снимает её с темы, поэтому циклы «подписался — отписался» не
накапливают ресурсов. Это верно и для потребителя, который вызвал
`return()`, не начав итерацию.

## Комбинаторы

Каждый комбинатор принимает `AsyncIterable` и возвращает новый
`AsyncIterableIterator`:

```typescript
import { filter, gapTimeout, limit } from '@nestling/streams';

const guarded = gapTimeout(limit(filter(source, keep), 50_000), 30_000);
```

| Комбинатор | Поведение |
|---|---|
| `tap(src, fn)` | вызывает `fn` для каждого элемента; исключение из `fn` прерывает поток |
| `filter(src, pred)` | пропускает только элементы, для которых `pred` вернул `true` |
| `limit(src, max, onExceeded?)` | отдаёт ровно `max` элементов, на следующем поток завершается ошибкой |
| `gapTimeout(src, ms, onTimeout?)` | завершается ошибкой, если источник молчит дольше `ms` (считается пауза источника, не потребителя) |
| `throttle(src, perSecond)` | ограничивает частоту до `perSecond` элементов в секунду; элементы буферизуются, не теряются |
| `batch(src, size)` | группирует элементы в массивы по `size`; остаток отдаётся при завершении источника |
| `through(src, fn)` | произвольное преобразование потока функцией `fn` |

`limit` и `gapTimeout` принимают фабрику ошибки. Без фабрики они бросают
`StreamLimitError` и `StreamGapTimeoutError` из этого пакета. Пайплайн
Nestling передаёт свои фабрики, поэтому внутри endpoint'а те же комбинаторы
завершаются встроенными отказами `payload_too_large` (413) и
`timeout` (504).

## Итерация под сигналом

```typescript
import { collect, untilAborted } from '@nestling/streams';

for await (const item of untilAborted(source, signal)) { … }

const items = await collect(source);
```

- `untilAborted(source, signal?)` завершает итерацию, когда сигнал взведён,
  и закрывает источник через `return()`. Поэтому `try/finally` внутри
  генератора-источника выполняется, а подписки снимаются. Без сигнала это
  прозрачная обёртка.
- `collect(source)` читает поток до конца и возвращает массив. Удобно в
  тестах.

## Границы пакета

Операторов dataflow (`merge`, `switchMap`, `combineLatest` и подобных) в
пакете нет: такие преобразования пишутся в хендлере любой библиотекой.
О статусах и `Fail` пакет не знает.
