# Реестр подписок

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-09-01).

Открытая подписка (`events(T)`, SSE) живёт минутами и часами. Рано или
поздно о ней спрашивают эксплуатационно: сколько их сейчас, чьи они, почему
узел не уходит в деплой и как закрыть конкретную. На эти вопросы отвечает
пакет `@nestling/subscriptions` — реестр активных подписок. Он написан
поверх публичных примитивов ядра: пайплайна, DI, `AbortSignal`, `Topic` и
контрактов.

Пакет состоит из трёх частей. Модуль `subscriptions()` подключается один
раз на приложение. Слой `tracked` композируется на endpoint. Реестр
`SubscriptionRegistry` инжектится как обычная зависимость.

## 1. Модуль — один раз на приложение

```typescript
// packages/examples.app-with-http/src/infrastructure.ts
import { subscriptions } from '@nestling/subscriptions';

export const appSubscriptions = subscriptions({
  identity: (ctx) => (ctx.input as { requestId?: string }).requestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,                      // публиковать факты открытия и закрытия контрактами
  node: 'app-with-http',
});
```

`subscriptions(options)` — функция, которая возвращает модуль. Это обычная
форма инфраструктурного модуля ([composition.md](./composition.md)).

Создайте значение один раз и импортируйте его туда, где оно нужно. Два
вызова `subscriptions({ … })` дают два разных модуля с одним именем, и
сборка падает. Модуль подключается либо в `modules:` корня, либо в
`imports:` модуля, чьи endpoint'ы отслеживаются:

```typescript
// packages/examples.app-with-http/src/modules/ops/ops.module.ts
export const OpsModule = makeAppModule({
  name: 'module:ops',
  imports: [appLogging, appSubscriptions],
  endpoints: [
    Health,
    ListSubscriptions,
    KillSubscription,
    WatchSubscriptions,
    SubscriptionOpenedInOps,
    SubscriptionClosedInOps,
  ],
});
```

Опции модуля:

| Опция | Что задаёт |
|---|---|
| `identity(ctx)` | кого считать подписантом: пакет этого не знает, знает приложение |
| `labels(ctx)` | метки подписки для фильтрации в `list()` |
| `publish` | публиковать ли факты `subscriptions.opened` и `subscriptions.closed` (раздел 5) |
| `node` | имя узла в публикуемых фактах |
| `feedBuffer` | буфер ленты `watch()` на одного наблюдателя, по умолчанию 256 |
| `onPublishError(error, event)` | обработчик ошибки публикации факта |

Все опции — решения композиции. Значение из окружения (например, `node`)
привяжите конфигом в корне и передайте сюда обычным значением.

## 2. Слой `tracked` на endpoint'е

```typescript
// packages/examples.app-with-http/src/modules/users/endpoints/activity-stream.endpoint.ts
import type { TrackedSubscription } from '@nestling/subscriptions';
import { tracked } from '@nestling/subscriptions';

export const ActivityStream = httpEndpoint({
  method: 'GET',
  path: '/api/users/activity',
  output: events(ActivityEvent),
  sse: { id: (event) => event.id, event: (event) => event.kind },
  pipeline: compose(basePipeline, tracked, subscriptionObserver),
  deps: [ActivityHub],
  handle:
    (hub: ActivityHub) =>
    async (
      _payload: unknown,
      meta: { subscription: TrackedSubscription; lastEventId?: string },
    ): Output<AsyncIterable<ActivityEvent>> =>
      new Ok(hub.subscribe(meta.subscription.signal)),
});
```

Слой добавляется композицией, как любое другое сквозное поведение. Слой
типизирован: хендлер видит `meta.subscription` в типах. Чтобы слой
гарантированно стоял на всех нужных endpoint'ах, объявите политику сборки:

```typescript
policies: [everyEndpoint({ transport: HttpTransport$ }).hasLayer(tracked, 'tracked')]
```

`subscriptionObserver` в примере — отдельный `.finally`-слой, который
пишет исход подписки и число отданных событий в лог. К реестру он не
относится.

### Сигнал: `meta.subscription.signal`

В этом месте легче всего ошибиться. В `meta` два сигнала:

| Поле | Когда срабатывает |
|---|---|
| `meta.signal` | сигнал запроса: клиент отключился или приложение останавливается |
| `meta.subscription.signal` | то же плюс `registry.abort(id)` |

Хендлер отслеживаемого endpoint'а подписывается на
`meta.subscription.signal`: одна подписка покрывает все три причины отмены.
Если подписаться на `meta.signal`, административное завершение не
сработает: запись исчезнет из реестра, а источник продолжит отдавать
события до отключения клиента.

`meta.signal` расширить нельзя: ключ `signal` в `meta` зарезервирован
пайплайном, потому что по нему считается исход запроса для всех
наблюдателей. Подробнее — запись
[ideas.md [2026-08-01]](../decisions/ideas.md), находка №1.

## 3. Административные endpoint'ы

Реестр — обычный singleton: добавьте `SubscriptionRegistry` в `deps`.

```typescript
// packages/examples.app-with-http/src/modules/ops/subscriptions.endpoint.ts
export const ListSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/api/ops/subscriptions',
  output: z.array(Subscription),
  pipeline: basePipeline,
  deps: [SubscriptionRegistry],
  handle:
    (registry: SubscriptionRegistry) =>
    async (): Output<z.infer<typeof Subscription>[]> =>
      new Ok(registry.list().map((info) => toWire(info))),
});

export const KillSubscription = httpEndpoint({
  method: 'DELETE',
  path: '/api/ops/subscriptions/:id',
  input: z.object({ id: z.string() }),
  errors: [SubscriptionNotFound],
  pipeline: basePipeline,
  deps: [SubscriptionRegistry],
  handle:
    (registry: SubscriptionRegistry) =>
    async (payload: {
      id: string;
    }): Output<null, ReturnType<typeof SubscriptionNotFound>> => {
      const killed = registry.abort(payload.id, 'administrative kill');

      if (!killed) {
        return SubscriptionNotFound({ id: payload.id });
      }

      return Ok.noContent();
    },
});
```

В примере у обоих endpoint'ов есть ещё поле `doc:` для OpenAPI; здесь оно
опущено.

`registry.list(filter?)` возвращает массив `SubscriptionInfo`. Это
замороженный снимок с полями `id`, `transport`, `pattern`, `kind`,
`identity?`, `labels`, `startedAt` (epoch ms) и `itemsOut`. Снимок
собирается заново при каждом вызове, поэтому наружу уходит значение, а не
объект, который меняет рантайм. Фильтр сравнивает `transport`, `pattern` и
`identity` на точное совпадение, а `labels` — как подмножество.

`registry.abort(id, reason?)` не удаляет запись, а только взводит сигнал
подписки. Запись снимет `.finally` пайплайна, когда поток действительно
закончится: реестр отражает факт, а не предсказывает его. Поэтому между
`DELETE` и исчезновением записи из списка проходит столько времени,
сколько нужно потоку, чтобы закрыться. `abort` возвращает `false`, если
подписки с таким `id` в этом процессе нет.

## 4. Живая лента

```typescript
// packages/examples.app-with-http/src/modules/ops/subscriptions.endpoint.ts
export const WatchSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/api/ops/subscriptions/live',
  output: events(SubscriptionChange),
  sse: { id: (change) => change.subscription.id, event: (change) => change.type },
  pipeline: compose(basePipeline, tracked),   // лента сама отслеживается
  deps: [SubscriptionRegistry],
  handle:
    (registry: SubscriptionRegistry) =>
    async (
      _payload: unknown,
      meta: { subscription: TrackedSubscription },
    ): Output<AsyncIterable<SubscriptionChange>> => {
      const feed = registry.watch(meta.subscription.signal);

      return new Ok(
        (async function* () {
          for await (const event of feed) {
            yield {
              type: event.type,
              reason: event.type === 'closed' ? event.reason : undefined,
              subscription: toWire(event.info),
            };
          }
        })(),
      );
    },
});
```

`registry.watch(signal)` возвращает `AsyncIterable` событий `opened` и
`closed`. Лента построена на `Topic` с буфером на каждого наблюдателя
(`feedBuffer`, по умолчанию 256) и политикой `drop-oldest`: наблюдатель,
который не успевает читать, теряет события, но регистрацию новых подписок
не задерживает.

Endpoint ленты сам композирован со слоем `tracked`, поэтому попадает в тот
реестр, который показывает. Событие `opened` публикуется до вызова
хендлера, то есть до того, как хендлер подписался на ленту. Поэтому лента
не показывает собственное открытие, но показывает все остальные события.

## 5. Факты жизненного цикла: наблюдение по кластеру

`abort()` действует только в своём процессе: реестр node-local. Наблюдение
при этом можно сделать кластерным одной опцией `publish: true`. Тогда
реестр публикует события `subscriptions.opened` и `subscriptions.closed`
как обычные `event`-контракты пакета, и любая фича может на них
подписаться:

```typescript
// packages/examples.app-with-http/src/modules/ops/subscription-facts.ts
export const SubscriptionOpenedInOps = implement(SubscriptionOpened, {
  subscriber: 'ops',
  deps: [ILogger],
  handle:
    (logger: ILoggerService) =>
    async (payload: { node?: string; id: string; transport: string; pattern: string }) => {
      logger.log(
        `[subscriptions] ${payload.node ?? 'local'}: открыта ${payload.id} ` +
          `(${payload.transport} ${payload.pattern})`,
      );

      return undefined;
    },
});
```

Каждый факт несёт имя узла (`node`), поэтому приёмник с хранилищем может
собрать картину всех процессов, не обращаясь к реестрам. Событие без
подписчиков — допустимая ситуация: `publish: true` без единого `implement`
ничего не доставляет и не считается ошибкой.

Публикация не задерживает подписку: факты ставятся в очередь и
отправляются асинхронно. Ошибка `emit` не прерывает работу, а передаётся в
необязательный обработчик `onPublishError(error, event)`. Публикация
включается явно, потому что стоит одного `emit` на каждое открытие и
закрытие подписки.

Кластерного `abort` в пакете нет: у `request`-контракта ровно один
владелец, а `event` в split-развёртывании доставляется одной реплике
queue-group, поэтому «закрыть подписку, не зная узла» через шину не
выразить. Тема отложена: [deferred.md](../decisions/deferred.md).

## 6. Квота подписок: pre-юнит приложения

Правило «не больше N подписок на пользователя» принадлежит приложению, а
не реестру. Напишите его как обычный `.pre`-юнит поверх `list(filter)`.
В коде примера этого юнита нет; сниппет показывает приём:

```typescript
const TooManySubscriptions = defineFail('TOO_MANY_SUBSCRIPTIONS', {
  status: 'TOO_MANY_REQUESTS',
  details: z.object({ limit: z.number() }),
  message: (d) => `No more than ${d.limit} live subscriptions per user`,
});

@Injectable([SubscriptionRegistry])
class LimitSubscriptions {
  constructor(private readonly registry: SubscriptionRegistry) {}

  handle(ctx: ExtendableContext<{ userId: string }>): void {
    const live = this.registry.list({ identity: ctx.input.userId });

    if (live.length >= 5) {
      throw TooManySubscriptions({ limit: 5 });
    }
  }
}

// Квота проверяется до регистрации: внутренним слоем относительно tracked
export const quota = makePipeline<{ userId: string }>().pre(LimitSubscriptions);
```

## Что стоит знать

- Endpoint со слоем `tracked`, но без модуля `subscriptions()` не
  собирается. Класс-юниты слоя резолвятся контейнером на фазе ASSEMBLE,
  поэтому ошибка приходит при сборке, а не на первом запросе.
- Административное завершение не видно наблюдателям ядра. Реестр сообщает
  причину `killed`, а `.finally`-юниты видят `completed`: их `Outcome`
  считается по сигналу запроса, который `abort` не трогает. У реестра свой
  перечень причин: `CloseReason = Outcome | 'killed'`.
- Потоковый ответ, который транспорт закрыл до первого элемента, запись не
  снимает. Это известное ограничение рантайма потоков (находка №4 записи
  [ideas.md [2026-08-01]](../decisions/ideas.md)).
- На SHUTDOWN лента закрывается раньше, чем завершатся потоки: наблюдатели
  завершаются нормально, но событий `closed` уже не получают.

## Дальше

- [design/streaming.md §4.1](../design/streaming.md) — целевое описание
  реестра и его место в модели стриминга.
- [guides/ports.md](./ports.md) — контракты и подписчики фактов.
- [guides/composition.md](./composition.md) — инфраструктурные модули и
  политики сборки.
