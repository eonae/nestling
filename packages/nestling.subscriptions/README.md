# @nestlingjs/subscriptions

Реестр активных подписок: список, принудительное закрытие одной или
нескольких, лента изменений. Пакет написан целиком на публичных примитивах
ядра — плагин, слой пайплайна и singleton в контейнере, — поэтому ядро о нём
не знает.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/streaming.md`](../../docs/design/streaming.md) §4.1.
> Гайд: [рецепт «Кто сейчас подключён и как его отключить»](../../docs/recipes/ops.md).

## Установка

```bash
npm install @nestlingjs/subscriptions
```

## Минимальный пример

```typescript
import { subscriptions, SubscriptionRegistry, tracked } from '@nestlingjs/subscriptions';

// 1. Плагин: создаётся один раз в композиционном корне
export const appSubscriptions = subscriptions({
  identity: (ctx) => (ctx.input as { userId?: string }).userId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true, // факты жизненного цикла как операции
  node: process.env.HOSTNAME,
});

// 2. Слой: добавляется в пайплайн endpoint'а, как любое сквозное поведение
export const Feed = httpEndpoint({
  method: 'GET',
  path: '/api/feed',
  output: events(Event),
  pipeline: compose(basePipeline, tracked),
  handler: FeedHandler, // получает meta.subscription с общим signal
});

// 3. Реестр инжектируется обычным DI-токеном: registry.list(), registry.kill()
```

## Экспорты

- **Подключение** — `subscriptions`, `SubscriptionsOptions`, `tracked`,
  `TrackSubscription`, `UntrackSubscription`.
- **Реестр** — `SubscriptionRegistry`, `SubscriptionInfo`,
  `SubscriptionFilter`, `SubscriptionKind`, `TrackedSubscription`,
  `SubscriptionKilledError`, `CloseReason`.
- **Факты жизненного цикла** ([design](../../docs/design/operations.md)) —
  `SubscriptionOpened`, `SubscriptionClosed`, `SubscriptionOpenedFact`,
  `SubscriptionClosedFact`, `SubscriptionEvent`.

Факты публикуются операциями, только если у плагина задано `publish: true`.

## Границы пакета

Реестр знает подписки своего процесса. Общего состояния между репликами у
него нет: список из соседнего процесса собирается вызовом операции.
