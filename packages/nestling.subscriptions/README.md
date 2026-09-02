# @nestling/subscriptions

Реестр активных подписок: список, принудительное закрытие одной или
нескольких, лента изменений.

> 🚧 Активная разработка, API может меняться. Целевой дизайн:
> [`docs/design/streaming.md`](../../docs/design/streaming.md) (§4.1).
> Гайд: [`docs/guides/subscriptions.md`](../../docs/guides/subscriptions.md).
> Результат замера, ради которого пакет написан:
> [`ideas.md [2026-08-01]`](../../docs/decisions/ideas.md).

Пакет написан целиком на публичных примитивах; ядро о нём не знает.
Зависимости:

| Зависимость | Для чего |
|---|---|
| `@nestling/container` | `@Injectable`, `@OnDestroy`, `makeModule`: юниты слоя и модуль |
| `@nestling/pipeline` | `makePipeline` для слоя `tracked`, `Outcome` и типы контекста |
| `@nestling/operations` | `makeRequest` / `makeCommand` / `makeEvent` для фактов жизненного цикла, `describeForm`/`isStreamKind`, `jsonSchema` |
| `@nestling/streams` | `Topic`: лента изменений |
| `@common/misc` | типы Standard Schema |

Внешних зависимостей, вендора схем и `@nestling/app` в пакете нет.

## Установка

```bash
npm install @nestling/subscriptions
```

## Минимальный пример

```typescript
import { subscriptions, SubscriptionRegistry, tracked } from '@nestling/subscriptions';

// 1. Модуль: создаётся один раз в composition root
export const appSubscriptions = subscriptions({
  identity: (ctx) => (ctx.input as { userId?: string }).userId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,                       // факты жизненного цикла как операции
  node: process.env.HOSTNAME,
});

// 2. Слой: добавляется в пайплайн endpoint'а, как любое сквозное поведение
export const Feed = httpEndpoint({
  method: 'GET',
  path: '/api/feed',
  output: events(Event),
  pipeline: compose(basePipeline, tracked),
  deps: [EventHub],
  handle: (hub: EventHub) => async (_payload, meta) =>
    // общий сигнал: отключение клиента, остановка приложения, закрытие администратором
    new Ok(hub.subscribe(meta.subscription.signal)),
});

// 3. Реестр: обычный singleton, инжектируется обычным токеном
export const ListSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/api/ops/subscriptions',
  output: z.array(SubscriptionSchema),
  pipeline: basePipeline,
  deps: [SubscriptionRegistry],
  handle: (registry: SubscriptionRegistry) => async () => new Ok(registry.list()),
});
```

## Основные понятия

### Реестр

`SubscriptionRegistry` хранит записи об активных подписках этого процесса
и отдаёт их снимками. `SubscriptionInfo` — замороженное значение: `id`,
`transport`, `pattern`, `kind`, `identity?`, `labels`, `startedAt` (epoch
ms), `itemsOut`. Снимок собирается в момент вызова; `itemsOut` читается из
`ctx.summary`. Наружу никогда не уходит объект, который рантайм меняет.

`list(filter)` сравнивает `transport`, `pattern` и `identity` точно, а
`labels` — как подмножество.

`abort()` запись не удаляет, а только взводит сигнал. Запись удаляется
обычным путём, из `.finally` пайплайна, когда поток действительно
закончился. Реестр отражает факт, а не опережает его.

### Сигнал подписки

`meta.signal` остаётся сигналом запроса: ключ `signal` в `meta` занят
пайплайном, и внешний код его не переопределяет. Поэтому слой `tracked`
добавляет своё типизированное поле:

```typescript
meta.subscription = {
  id: string,
  signal: AbortSignal,   // AbortSignal.any([ctx.signal, контроллер администратора])
}
```

Одна подписка на этот сигнал покрывает все три причины отмены: отключение
клиента, остановку приложения и закрытие администратором. Хендлер, который
слушает `meta.signal`, переживёт `registry.abort(id)`: запись из реестра
уйдёт, а источник продолжит отдавать данные, пока клиент не отключится.
Типы этого не ловят, оба поля существуют. Используйте
`meta.subscription.signal`.

### Причина закрытия

```typescript
type CloseReason = Outcome | 'killed';
// 'completed' | 'disconnected' | 'aborted' | 'failed' | 'killed'
```

Пайплайн описывает исход запроса, реестр — судьбу подписки. `computeOutcome`
смотрит на сигнал запроса, поэтому источник, закрытый контроллером реестра,
отчитывается как `completed`. Наблюдатель, который читает только `outcome`
(например, `.finally`-юнит аудита), о закрытии администратором не узнает.

### Факты жизненного цикла

С `publish: true` реестр публикует две `event`-операции:
`subscriptions.opened` и `subscriptions.closed`. Оба несут имя узла
(`node`). Чтобы наблюдать подписки всего кластера, другая фича делает
`implement(SubscriptionOpened, { subscriber: 'ops', … })` и получает
факты со всех узлов.

Схемы фактов написаны руками (`vendor: 'nestling'`) и аннотированы
`jsonSchema(...)`: пакет не тянет zod и не навязывает приложению вендора
схем, а аннотация делает факты документируемыми и сравнимыми.

Публикация никогда не блокирует подписку: факты ставятся в очередь и
сохраняют порядок; ошибка `emit` проглатывается и передаётся в хук
`onPublishError(error, event)`. По умолчанию публикация выключена: на
удалённой шине каждый факт — сетевой вызов, и платить его за каждую
подписку должна решить композиция.

### Модуль

Значение модуля создаётся один раз и импортируется теми, кому нужно.
Второй вызов `subscriptions({ … })` даёт другое значение с тем же именем и
роняет сборку: идентичность модуля — само значение.

Опции модуля — решения композиции. Ничего «из окружения» здесь нет: если
`node` нужно брать из окружения, привяжите его через конфиг в корне.

## Справочник API

### `SubscriptionRegistry`

| Член | Что делает |
|---|---|
| `list(filter?)` | снимки активных подписок; собираются заново при каждом вызове |
| `get(id)` | один снимок или `undefined` |
| `abort(id, reason?)` | взводит контроллер администратора; `true`, если запись существовала |
| `abortAll(filter?, reason?)` | то же для всех записей по фильтру; возвращает их число |
| `watch(signal?)` | `AsyncIterableIterator<SubscriptionEvent>` над лентой изменений |
| `size` | число активных подписок в этом процессе |

### Опции `subscriptions(options)`

| Опция | Что делает |
|---|---|
| `identity` | извлекает подписчика из контекста запроса |
| `labels` | извлекает метки подписки |
| `feedBuffer` | буфер ленты на наблюдателя (по умолчанию 256, `drop-oldest`) |
| `publish` | публиковать факты жизненного цикла операциями (по умолчанию `false`) |
| `node` | имя узла в фактах |
| `onPublishError` | наблюдатель ошибок публикации |

### Экспорты

| Экспорт | Что это |
|---|---|
| `subscriptions(options)` | фабрика модуля |
| `tracked` | слой пайплайна, который регистрирует подписку |
| `SubscriptionRegistry` | реестр и его токен |
| `SubscriptionOpened`, `SubscriptionClosed` | `event`-операции фактов |
| `SubscriptionKilledError` | ошибка, с которой закрывается подписка после `abort` |
| `SubscriptionInfo`, `SubscriptionFilter`, `SubscriptionEvent`, `CloseReason`, `SubscriptionKind`, `TrackedSubscription` | типы модели |
| `TrackSubscription`, `UntrackSubscription` | класс-юниты слоя; регистрирует их модуль, вызывать вручную не нужно |

`TrackSubscription` и `UntrackSubscription` экспортируются потому, что
класс-юнит попадает в тип декларации, композированной от `tracked`; без
имени в публичной поверхности такая декларация в другом пакете не прошла
бы проверку типов (TS2742).

## Границы пакета

- Закрытие подписок по всему кластеру: реестр локален для узла, `abort()`
  действует в своём процессе. Наблюдение кластерное (через факты). См.
  [`deferred.md`](../../docs/decisions/deferred.md).
- История: в реестре только активные подписки.
- Метрики и дашборды: `itemsOut` есть в снимке, экспортёра и агрегатов нет.
- Квоты («не больше N на пользователя»): это `.pre`-юнит приложения над
  `registry.list(filter)`; гайд показывает пример.
- Автоматическая расстановка слоя: `tracked` добавляется явно, а «слой
  стоит везде, где нужен» проверяет политика сборки
  `everyEndpoint(…).hasLayer(tracked)`.

## Известные ограничения

- Потоковый ответ, который транспорт закрыл до первого `next()`, не
  выполняет `.finally`: обёртка завершения — асинхронный генератор, и
  `return()` на незапущенном генераторе его тело не выполняет. Такая запись
  остаётся в реестре до конца жизни процесса. Это ограничение ядра,
  зафиксированное как находка №4 замера и закреплённое тестом
  `src/core-limits.spec.ts`.
- `@OnDestroy` закрывает ленту, поэтому на SHUTDOWN наблюдатели
  завершаются нормально, но не видят события закрытия подписок, которые
  завершаются после них. Иначе наблюдатель, сам будучи подпиской, мешал бы
  процессу остановиться.

## Dev-зависимости

Тесты используют `@nestling/testing` (и через него `@nestling/app`),
`@nestling/ports` и `@nestling/transport`. Это `devDependencies`: граф
зависимостей пакета в production — пять пакетов из таблицы выше.
