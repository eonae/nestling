# 23. Кто сейчас подключён и как его отключить

> Гайд по текущему API; сверено с кодом `app-with-http` (2026-09-05).
> Целевое описание: [design/streaming.md](../design/streaming.md), раздел
> «4.1 Реестр подписок». Почему так: запись
> [ideas.md](../decisions/ideas.md) «[2026-08-01] Реестр подписок:
> результат dogfooding-замера».

У сервиса есть лента по SSE из [главы 14](./14-live-feed.md), и клиенты
держат её открытой часами. Эксплуатации нужно видеть список открытых
подписок этого процесса, закрывать зависшую подписку по идентификатору и
наблюдать открытия и закрытия в реальном времени. Хендлер ленты при этом
не должен знать, кто и зачем его закрыл.

Реестр подписок живёт в отдельном пакете `@nestling/subscriptions`. Он
написан на публичных примитивах ядра и подключается как плагин; ядро о
нём не знает.

## Плагин в корне

```typescript
// examples/app-with-http/src/app.ts (фрагмент)
import { subscriptions } from '@nestling/subscriptions';
// …

export const appSubscriptions = subscriptions({
  identity: (ctx) => (ctx.input as { requestId?: string }).requestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,
  node: 'app-with-http',
});

export const app = makeApp({
  features: [UsersFeature, QuotasFeature, OpsFeature],
  plugins: [
    appLogging,
    appAuth,
    appSubscriptions,
    // …
  ],
  // …
});
```

`subscriptions(options)` возвращает плагин. Значение создаётся один раз и
перечисляется в `plugins:`, как плагин логирования из
[главы 12](./12-features.md). Класс-юниты слоя подписок регистрирует
именно этот плагин: endpoint со слоем `tracked` в сборке без
`appSubscriptions` останавливает старт на фазе ASSEMBLE, потому что
незарегистрированный класс-юнит не создаётся.

Опции описывают решения композиции. `identity` вычисляет подписчика из
контекста запроса: здесь это `requestId` слоя `observability`, в
приложении с аутентификацией на его месте был бы идентификатор
пользователя. `labels` добавляет метки к записи. `publish: true`
включает публикацию фактов открытия и закрытия операциями (см. далее); по
умолчанию она выключена. `node` называет процесс в фактах.

## Слой `tracked` на endpoint'е подписки

```typescript
// examples/app-with-http/src/features/users/endpoints/activity-stream.endpoint.ts
@Injectable([ActivityHub])
class ActivityStreamHandler {
  constructor(private readonly hub: ActivityHub) {}

  async handle(
    _payload: unknown,
    meta: { subscription: TrackedSubscription; lastEventId?: string },
  ): Output<AsyncIterable<ActivityEvent>> {
    // Настоящая лента отдала бы историю с этого места
    const since = meta.lastEventId ?? '0';

    return new Ok(this.hub.subscribe(meta.subscription.signal, since));
  }
}

export const ActivityStream = httpEndpoint({
  method: 'GET',
  path: '/users/activity',
  output: events(ActivityEvent),
  sse: {
    id: (event) => event.id,
    event: (event) => event.kind,
  },
  doc: { summary: 'Лента активности (SSE)', tags: ['users'] },
  pipeline: compose(observability, tracked),
  handler: ActivityStreamHandler,
});
```

`tracked` — слой пайплайна из пакета. Его `.pre`-юнит регистрирует
подписку в реестре до вызова хендлера, а `.finally`-юнит снимает запись,
когда поток закрылся. Слой добавляется через `compose`, как любой
сквозной слой из [главы 8](./08-logging.md).

Слой кладёт в контекст поле `subscription` с идентификатором записи и
сигналом. Хендлер слушает `meta.subscription.signal`, а не `meta.signal`.
`meta.signal` остаётся сигналом запроса: он взводится при отключении
клиента и при остановке приложения. `meta.subscription.signal` объединяет
его с сигналом администратора, поэтому одна подписка на него закрывает
поток по всем трём причинам. Хендлер, который слушает только
`meta.signal`, после закрытия администратором продолжит отдавать данные:
запись из реестра уйдёт, а поток нет.

Что слой стоит на каждом endpoint'е с подпиской, можно проверить
политикой `everyEndpoint({ pattern: /\/live$/ }).hasLayer(tracked)`, как в
[главе 9](./09-auth.md). В примере такой политики нет: слой подключён на
обоих `events`-endpoint'ах вручную.

## Endpoint'ы эксплуатации

Реестр инжектируется обычным токеном `SubscriptionRegistry`. Endpoint'ы
лежат в фиче `ops`: у неё нет своих провайдеров, логирование,
аутентификация и реестр приходят плагинами.

```typescript
// examples/app-with-http/src/features/ops/subscriptions.endpoint.ts
@Injectable([SubscriptionRegistry])
class ListSubscriptionsHandler {
  constructor(private readonly registry: SubscriptionRegistry) {}

  async handle(): Output<Subscription[]> {
    return this.registry.list().map((info) => toWire(info));
  }
}

export const ListSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/ops/subscriptions',
  output: z.array(Subscription),
  doc: { summary: 'Активные подписки этого узла', tags: ['ops'] },
  pipeline: observability,
  handler: ListSubscriptionsHandler,
});
```

`registry.list()` отдаёт снимки записей: идентификатор, транспорт,
паттерн, вид формы, подписчика, метки, время старта и число отданных
элементов. `toWire` переводит снимок в схему ответа API.

```typescript
// examples/app-with-http/src/features/ops/subscriptions.endpoint.ts
@Injectable([SubscriptionRegistry])
class KillSubscriptionHandler {
  constructor(private readonly registry: SubscriptionRegistry) {}

  async handle(payload: {
    id: string;
  }): Output<null, typeof SubscriptionNotFound> {
    const killed = this.registry.abort(payload.id, 'administrative kill');

    return killed ? Ok.noContent() : SubscriptionNotFound({ id: payload.id });
  }
}

export const KillSubscription = httpEndpoint({
  method: 'DELETE',
  path: '/ops/subscriptions/:id',
  input: z.object({ id: z.string() }),
  errors: [SubscriptionNotFound, Unauthorized],
  doc: { summary: 'Завершить подписку', tags: ['ops'], status: 'no_content' },
  pipeline: authed,
  handler: KillSubscriptionHandler,
});
```

`registry.abort(id, reason)` взводит сигнал администратора и возвращает
`false`, если записи нет. Запись из реестра при этом не удаляется: её
снимет `.finally` слоя `tracked`, когда поток действительно закроется.
Реестр отражает факт, а не опережает его. Endpoint стоит под слоем
`authed`: удалять чужие подписки может только тот, кто предъявил токен.

```typescript
// examples/app-with-http/src/features/ops/subscriptions.endpoint.ts (фрагмент)
@Injectable([SubscriptionRegistry])
class WatchSubscriptionsHandler {
  constructor(private readonly registry: SubscriptionRegistry) {}

  async handle(
    _payload: unknown,
    meta: { subscription: TrackedSubscription },
  ): Output<AsyncIterable<SubscriptionChange>> {
    const feed = this.registry.watch(meta.subscription.signal);

    return new Ok(
      (async function* () {
        for await (const event of feed) {
          // …
        }
      })(),
    );
  }
}

export const WatchSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/ops/subscriptions/live',
  output: events(SubscriptionChange),
  sse: {
    id: (change) => change.subscription.id,
    event: (change) => change.type,
  },
  doc: { summary: 'Лента изменений реестра подписок (SSE)', tags: ['ops'] },
  pipeline: compose(observability, tracked),
  handler: WatchSubscriptionsHandler,
});
```

`registry.watch(signal)` отдаёт `AsyncIterable` событий `opened` и
`closed`. Лента сама является подпиской: она композирована от `tracked`
и видна в собственном списке. Своё событие `opened` она не получает: оно
опубликовано до вызова хендлера, то есть до того, как хендлер подписался.

## Факты открытия и закрытия

```typescript
// examples/app-with-http/src/features/ops/subscription-facts.ts (фрагмент)
@Injectable([Logger$])
class SubscriptionOpenedInOpsHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: {
    node?: string;
    id: string;
    transport: string;
    pattern: string;
  }) {
    this.logger.log(
      `[subscriptions] ${payload.node ?? 'local'}: opened ${payload.id} ` +
        `(${payload.transport} ${payload.pattern})`,
    );
  }
}

export const SubscriptionOpenedInOps = implement(SubscriptionOpened, {
  subscriber: 'ops',
  handler: SubscriptionOpenedInOpsHandler,
});
// …
```

С `publish: true` реестр публикует события `subscriptions.opened` и
`subscriptions.closed` как обычные операции вида `event` из
[главы 13](./13-events.md). Фича `ops` подписана на оба через
`implement` с именем подписчика; реализация `SubscriptionClosedInOps`
устроена так же. Реестр локален для процесса, а факты уходят на шину: в
split-развёртывании из [главы 17](./17-split.md) один процесс собирает
картину по всем узлам, и поле `node` говорит, где подписка открыта.
Закрыть подписку в другом процессе через `abort` нельзя.

Пакет не тянет валидатор схем и не требует правок ядра: схемы фактов
аннотированы `jsonSchema()`, поэтому они попадают в документ OpenAPI и в
снапшот совместимости из [главы 18](./18-compatibility.md).

## Проба живости в той же фиче

Проба живости для балансировщика из [главы 9](./09-auth.md) в этом
приложении называется `Health` и лежит в той же фиче `ops`
(`features/ops/health.endpoint.ts`, `features/ops/ops.feature.ts`): она
выведена из-под политик полем `detached` и скрыта из документа OpenAPI
полем `doc.hidden`, как и в главе 9. Это endpoint для инфраструктуры, а
не для пользователя API. Своих провайдеров у фичи нет, `providers: []`.
Фича `ops` входит в любую топологию и выбирается явно, как показывает
[глава 16](./16-select.md).

## Запросы

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn workspace @examples/app-with-http start:dev

# в отдельных терминалах: подписка и лента реестра
curl -N localhost:3000/users/activity
curl -N localhost:3000/ops/subscriptions/live

curl localhost:3000/ops/subscriptions
# [{"id":"d5bd…","transport":"http","pattern":"GET /ops/subscriptions/live","kind":"events",…},
#  {"id":"86cc…","transport":"http","pattern":"GET /users/activity","kind":"events","identity":"43cb…","labels":{"transport":"http"},"startedAt":1788410536706,"itemsOut":0}]

curl -X DELETE localhost:3000/ops/subscriptions/86cc… -H 'authorization: Bearer secret'
# 204

curl localhost:3000/ops/subscriptions
# [{"id":"d5bd…","pattern":"GET /ops/subscriptions/live",…,"itemsOut":2}]

curl -X DELETE localhost:3000/ops/subscriptions/nope -H 'authorization: Bearer secret'
# {"error":"Subscription nope is not active on this node","code":"not_found:subscription","details":{"id":"nope"}}  404
```

Терминал с `curl -N localhost:3000/users/activity` после `DELETE`
завершается: поток закрыт сигналом администратора. Лента реестра получила
два кадра:

```
event: opened
data: {"type":"opened","subscription":{"id":"86cc…","pattern":"GET /users/activity",…,"itemsOut":0}}

event: closed
data: {"type":"closed","reason":"killed","subscription":{"id":"86cc…",…,"itemsOut":1}}
```

Подписчик фактов в `ops` записал те же события в лог:

```
[app-with-http] [subscriptions] app-with-http: opened 86cc… (http GET /users/activity)
[app-with-http] [subscriptions] app-with-http: closed 86cc…: killed, 1 items
```

## Проверка

```typescript
// examples/app-with-http/src/app.spec.ts
it('показывает подписку, завершает её и удаляет запись', async () => {
  await using testApp = await assembleTest(app, {
    ...testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  const subscription = streamOf<{ kind: string }>(
    await testApp.call(ActivityStream),
  );

  // Подписка видна в списке до того, как отдан первый элемент
  const [listed] = unwrap(await testApp.call(ListSubscriptions));
  expect(listed).toMatchObject({
    transport: 'http',
    pattern: 'GET /users/activity',
    kind: 'events',
    itemsOut: 0,
  });

  unwrap(await createUser(testApp, 'subscriber'));
  const delivered = await subscription.next();
  expect(delivered.value).toMatchObject({ kind: 'created' });
  expect(unwrap(await testApp.call(ListSubscriptions))[0].itemsOut).toBe(1);

  // Администратор завершает подписку: поток закрывается сам
  const killed = await testApp.call(
    KillSubscription,
    { id: listed.id },
    asClient,
  );
  expect(killed.status).toBe('no_content');

  const tail: unknown[] = [];
  for await (const event of subscription) {
    tail.push(event);
  }
  expect(tail).toEqual([]);

  // Запись снял `.finally` пайплайна, когда поток закрылся
  expect(unwrap(await testApp.call(ListSubscriptions))).toEqual([]);
});
```

App-тест проходит весь сценарий без сокета: `testApp.call` на
`events`-endpoint'е возвращает итератор, список показывает запись до
первого элемента, `KillSubscription` закрывает поток, и итерация
завершается сама. Два других теста того же `describe` проверяют отказ
`not_found:subscription` и то, что лента реестра не видит собственного
`opened`.

```bash
yarn workspace @examples/app-with-http test
```

Те же примитивы без `makeApp`: встраивание в чужой сервер и контейнер
без приложения, [глава 24](./24-standalone.md).
