# Реестр подписок: посмотреть, убить, наблюдать

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-08-01).

Открытая подписка (`events(T)`, SSE) живёт минутами и часами. Рано или
поздно про неё спрашивают эксплуатационно: сколько их сейчас, чьи они,
почему узел не уходит в деплой и как закрыть вон ту. Отвечает на это
satellite-пакет `@nestling/subscriptions` — реестр активных подписок,
написанный целиком поверх публичных примитивов: в ядре под него нет ни
строчки.

Три части: **модуль** (подключается один раз), **слой `tracked`**
(композируется на ручку) и **реестр** (инжектится обычным токеном).

## 1. Модуль — один раз на приложение

```typescript
// src/infrastructure.ts
import { subscriptions } from '@nestling/subscriptions';

export const appSubscriptions = subscriptions({
  // Кого считать подписантом — знает приложение, а не пакет
  identity: (ctx) => (ctx.input as { requestId?: string }).requestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,                      // факты жизненного цикла контрактами
  node: 'app-with-http',
});
```

Форма — обычная конвенция инфраструктурного модуля: функция, возвращающая
модуль ([composition.md](./composition.md)). Ни поля `plugins:` в корне, ни
`forRoot` под это не появилось.

Значение создаётся **один раз** и импортируется теми, кому нужно: два вызова
`subscriptions({ … })` дадут два разных значения под одним именем и уронят
сборку. Модуль едет либо в `modules:` корня, либо в `imports:` того модуля,
чьи ручки трекаются:

```typescript
export const OpsModule = makeAppModule({
  name: 'module:ops',
  imports: [appLogging, appSubscriptions],
  endpoints: [Health, ListSubscriptions, KillSubscription, WatchSubscriptions],
});
```

Опции — только решения композиции. Ничего «из среды» в них нет: `node` при
желании привязывается конфигом в корне и приезжает сюда обычным значением.

## 2. Слой на ручке — и правильный сигнал

```typescript
import { tracked } from '@nestling/subscriptions';
import type { TrackedSubscription } from '@nestling/subscriptions';

export const ActivityStream = httpEndpoint({
  method: 'GET',
  path: '/api/users/activity',
  output: events(ActivityEventSchema),
  sse: { id: (event) => event.id, event: (event) => event.kind },
  pipeline: compose(noValidationPipeline, tracked),
  deps: [ActivityHub],
  handle:
    (hub: ActivityHub) =>
    async (_payload: unknown, meta: { subscription: TrackedSubscription }) =>
      new Ok(hub.subscribe(meta.subscription.signal)),
});
```

Слой ставится **композицией**, как любое другое сквозное поведение: ambient
middleware в модели нет. Хотите гарантии «стоит везде, где нужен» — она
выражается политикой сборки, а не механизмом:

```typescript
policies: [everyEndpoint({ transport: HttpTransport$ }).hasLayer(tracked, 'tracked')]
```

### Сигнал именно `meta.subscription.signal`

Это единственное место гайда, где легко ошибиться. В `meta` два сигнала, и
они разные:

| Поле | Что взводит |
|---|---|
| `meta.signal` | сигнал **запроса**: дисконнект клиента, graceful shutdown |
| `meta.subscription.signal` | то же **плюс** `registry.abort(id)` |

Хендлер трекаемой ручки слушает второй: одна подписка на него закрывает все
три причины отмены. Хендлер, подписавшийся на `meta.signal`, переживёт
административный kill — запись из реестра уйдёт, а источник продолжит течь
до дисконнекта.

Почему не расширить `meta.signal`: ключ `signal` в `meta` зарезервирован
пайплайном (capability `request-abort-signal`). Это гарантия, а не
неудобство: слой, подменивший сигнал запроса, сломал бы вычисление исхода
для всех наблюдателей сразу. Логика решения — запись
[ideas.md [2026-08-01]](../decisions/ideas.md), находка №1.

## 3. Админские ручки

Реестр — обычный singleton: `deps: [SubscriptionRegistry]`, и всё.

```typescript
export const ListSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/api/ops/subscriptions',
  output: z.array(Subscription),
  pipeline: basePipeline,
  deps: [SubscriptionRegistry],
  handle: (registry: SubscriptionRegistry) => async () =>
    new Ok(registry.list().map(toWire)),
});

export const KillSubscription = httpEndpoint({
  method: 'DELETE',
  path: '/api/ops/subscriptions/:id',
  input: z.object({ id: z.string() }),
  errors: [SubscriptionNotFound],
  pipeline: basePipeline,
  deps: [SubscriptionRegistry],
  handle: (registry: SubscriptionRegistry) => async (payload: { id: string }) =>
    registry.abort(payload.id, 'administrative kill')
      ? Ok.noContent()
      : SubscriptionNotFound({ id: payload.id }),
});
```

`SubscriptionInfo` — замороженный снимок (`id`, `transport`, `pattern`,
`kind`, `identity?`, `labels`, `startedAt` в epoch ms, `itemsOut`),
собираемый заново на каждый вызов: наружу уезжает значение, а не объект,
который мутирует рантайм. `list(filter)` фильтрует точным совпадением по
`transport`/`pattern`/`identity` и подмножеством `labels`.

`abort()` запись **не удаляет** — только взводит сигнал. Запись снимет
`.finally` пайплайна, когда поток действительно закончится: реестр отражает
факт, а не опережает его. Поэтому между `DELETE` и исчезновением записи из
списка проходит ровно столько, сколько нужно потоку, чтобы закрыться.

## 4. Живая лента — и рекурсия

```typescript
export const WatchSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/api/ops/subscriptions/live',
  output: events(SubscriptionChange),
  sse: { event: (change) => change.type },
  pipeline: compose(noValidationPipeline, tracked),   // ← сама трекается
  deps: [SubscriptionRegistry],
  handle:
    (registry: SubscriptionRegistry) =>
    async (_payload: unknown, meta: { subscription: TrackedSubscription }) => {
      const feed = registry.watch(meta.subscription.signal);

      return new Ok(
        (async function* () {
          for await (const event of feed) {
            yield { type: event.type, subscription: toWire(event.info) };
          }
        })(),
      );
    },
});
```

Ручка живого просмотра сама композирована от `tracked`, поэтому попадает в
тот реестр, который показывает. Порядок при этом определён: `opened`
публикуется **до** вызова хендлера, то есть до того, как хендлер подписался
на ленту, — своего собственного открытия она не увидит, чужие увидит. Это
документированное поведение, а не дефект.

Лента — `Topic` с буфером на наблюдателя (`feedBuffer`, по умолчанию 256) и
политикой `drop-oldest`: наблюдатель, который не успевает читать, теряет
события, но регистрацию новых подписок не задерживает.

## 5. Факты жизненного цикла — наблюдение по кластеру

`abort()` действует только в своём процессе (реестр node-local), а вот
**наблюдение** кластерное и стоит одной строки — включённой публикации:

```typescript
export const SubscriptionOpenedInOps = implement(SubscriptionOpened, {
  subscriber: 'ops',
  deps: [ILogger],
  handle: (logger: ILoggerService) => async (payload) => {
    logger.log(`[subscriptions] ${payload.node}: открыта ${payload.id}`);

    return undefined;
  },
});
```

`subscriptions.opened` и `subscriptions.closed` — обычные `event`-контракты
пакета; факт несёт имя узла, поэтому приёмник со стораджем собирает картину
всех процессов, не касаясь реестра. У события ноль подписчиков легален:
`publish: true` без единого `implement` просто ничего не доставляет.

Цена включения — публикация на каждой открытой и закрытой подписке, поэтому
она opt-in. Публикация не блокирует подписку: она поставлена в очередь,
отказ `emit` гасится и уходит в необязательный `onPublishError(error,
event)`.

Чего в V1 **нет**: кластерного kill. `request`-контракт имеет ровно одного
владельца, а `event` в split-топологии доставляется по queue-group одной
реплике, поэтому «убей подписку, не зная узла» пакет не изображает —
[deferred.md](../decisions/deferred.md).

## 6. Квоты подписок — приложенческий pre-юнит

Политика «не больше N подписок на пользователя» принадлежит приложению, а
не реестру. Пишется обычным pre-юнитом поверх `list(filter)`:

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

// Квота проверяется ДО регистрации: внутренним слоем относительно tracked
export const quota = makePipeline<{ userId: string }>().pre(LimitSubscriptions);
```

## Что стоит знать

- **Ручка со слоем, но без модуля не собирается.** Класс-юниты слоя
  резолвятся контейнером на фазе ASSEMBLE — отказ приходит на сборке, а не
  на первом запросе.
- **Административное завершение наблюдателям ядра не видно.** Реестр
  сообщает `killed`, а `.finally`-юниты видят `completed`: их `Outcome`
  считается по сигналу запроса, который kill не взводит. Словарь ядра ради
  этого не расширяется — у реестра свой: `CloseReason = Outcome | 'killed'`.
- **Потоковый ответ, закрытый транспортом до первого элемента, запись не
  снимает** — известное ограничение рантайма потоков (находка №4 записи
  [ideas.md [2026-08-01]](../decisions/ideas.md)).
- **На SHUTDOWN лента закрывается раньше, чем дотекут потоки:** наблюдатели
  завершаются нормально, но событий закрытия уже не получают.

## Дальше

- [design/streaming.md §4.1](../design/streaming.md) — целевое описание
  реестра и его место в модели стриминга.
- [guides/ports.md](./ports.md) — контракты и подписчики фактов.
- [guides/composition.md](./composition.md) — инфраструктурные модули и
  политики сборки.
