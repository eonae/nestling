# 22. Кто сейчас подключён и как его отключить

> Гайд по текущему API; сверено с кодом `examples.app-with-http` (2026-09-03).
> Целевое описание: [design/streaming.md](../design/streaming.md), раздел
> «4.1 Реестр подписок». Почему так: запись
> [ideas.md](../decisions/ideas.md) «[2026-08-01] Реестр подписок:
> результат dogfooding-замера».

## Задача

У сервиса есть лента по SSE из [главы 14](./14-live-feed.md), и клиенты
держат её открытой часами. Эксплуатации нужно видеть список открытых
подписок этого процесса, закрывать зависшую подписку по идентификатору и
наблюдать открытия и закрытия в реальном времени. Хендлер ленты при этом
не должен знать, кто и зачем его закрыл.

## Решение

Реестр подписок живёт в отдельном пакете `@nestling/subscriptions`. Он
написан на публичных примитивах ядра и подключается как плагин; ядро о
нём не знает. Как устроен такой пакет, разбирает
[глава 25](./25-extending.md).

### Шаг 1. Плагин в корне

```typescript
// packages/examples.app-with-http/src/app.ts
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
[главы 12](./12-features.md).

Опции описывают решения композиции. `identity` вычисляет подписчика из
контекста запроса: здесь это `requestId` слоя `observability`, в
приложении с аутентификацией на его месте был бы идентификатор
пользователя. `labels` добавляет метки к записи. `publish: true`
включает публикацию фактов открытия и закрытия операциями (шаг 4); по
умолчанию она выключена. `node` называет процесс в фактах.

### Шаг 2. Слой `tracked` на endpoint'е подписки

```typescript
// packages/examples.app-with-http/src/features/users/endpoints/activity-stream.endpoint.ts
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
  handler: {
    deps: [ActivityHub],
    handle:
      (hub: ActivityHub) =>
      async (
        _payload: unknown,
        meta: { subscription: TrackedSubscription; lastEventId?: string },
      ): Output<AsyncIterable<ActivityEvent>> => {
        // Настоящая лента отдала бы историю с этого места
        const since = meta.lastEventId ?? '0';

        return new Ok(hub.subscribe(meta.subscription.signal, since));
      },
  },
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

### Шаг 3. Endpoint'ы эксплуатации

Реестр инжектируется обычным токеном `SubscriptionRegistry`. Endpoint'ы
лежат в фиче `ops`: у неё нет своих провайдеров, логирование,
аутентификация и реестр приходят плагинами.

```typescript
// packages/examples.app-with-http/src/features/ops/subscriptions.endpoint.ts
export const ListSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/ops/subscriptions',
  output: z.array(Subscription),
  doc: { summary: 'Активные подписки этого узла', tags: ['ops'] },
  pipeline: observability,
  handler: {
    deps: [SubscriptionRegistry],
    handle:
      (registry: SubscriptionRegistry) => async (): Output<Subscription[]> =>
        registry.list().map((info) => toWire(info)),
  },
});
```

`registry.list()` отдаёт снимки записей: идентификатор, транспорт,
паттерн, вид формы, подписчика, метки, время старта и число отданных
элементов. `toWire` переводит снимок в схему ответа API.

```typescript
// packages/examples.app-with-http/src/features/ops/subscriptions.endpoint.ts
export const KillSubscription = httpEndpoint({
  method: 'DELETE',
  path: '/ops/subscriptions/:id',
  input: z.object({ id: z.string() }),
  errors: [SubscriptionNotFound, Unauthorized],
  doc: { summary: 'Завершить подписку', tags: ['ops'], status: 'no_content' },
  pipeline: authed,
  handler: {
    deps: [SubscriptionRegistry],
    handle:
      (registry: SubscriptionRegistry) =>
      async (payload: {
        id: string;
      }): Output<null, typeof SubscriptionNotFound> => {
        const killed = registry.abort(payload.id, 'administrative kill');

        return killed ? Ok.noContent() : SubscriptionNotFound({ id: payload.id });
      },
  },
});
```

`registry.abort(id, reason)` взводит сигнал администратора и возвращает
`false`, если записи нет. Запись из реестра при этом не удаляется: её
снимет `.finally` слоя `tracked`, когда поток действительно закроется.
Реестр отражает факт, а не опережает его. Endpoint стоит под слоем
`authed`: удалять чужие подписки может только тот, кто предъявил токен.

```typescript
// packages/examples.app-with-http/src/features/ops/subscriptions.endpoint.ts
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
  handler: {
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
              // …
            }
          })(),
        );
      },
  },
});
```

`registry.watch(signal)` отдаёт `AsyncIterable` событий `opened` и
`closed`. Лента сама является подпиской: она композирована от `tracked`
и видна в собственном списке. Своё событие `opened` она не получает: оно
опубликовано до вызова хендлера, то есть до того, как хендлер подписался.

### Шаг 4. Факты открытия и закрытия

```typescript
// packages/examples.app-with-http/src/features/ops/subscription-facts.ts
export const SubscriptionOpenedInOps = implement(SubscriptionOpened, {
  subscriber: 'ops',
  handler: {
    deps: [Logger$],
    handle:
      (logger: Logger) =>
      async (payload: {
        node?: string;
        id: string;
        transport: string;
        pattern: string;
      }) => {
        logger.log(
          `[subscriptions] ${payload.node ?? 'local'}: opened ${payload.id} ` +
            `(${payload.transport} ${payload.pattern})`,
        );

        // eslint-disable-next-line unicorn/no-useless-undefined
        return undefined;
      },
  },
});
```

С `publish: true` реестр публикует события `subscriptions.opened` и
`subscriptions.closed` как обычные операции вида `event` из
[главы 13](./13-events.md). Фича `ops` подписана на оба через
`implement` с именем подписчика. Реестр локален для процесса, а факты
уходят на шину: в split-развёртывании из [главы 17](./17-split.md) один
процесс собирает картину по всем узлам, и поле `node` говорит, где
подписка открыта. Закрыть подписку в другом процессе через `abort` нельзя.

### Шаг 5. Проба живости в той же фиче

`CheckHealth` с `detached` и `doc.hidden` из [главы 9](./09-auth.md) лежит
в той же фиче `ops` (`features/ops/ops.feature.ts`): это endpoint для
инфраструктуры, а не для пользователя API. Своих провайдеров у фичи
нет, `providers: []`.
Фича `ops` входит в любую топологию и выбирается явно, как показывает
[глава 16](./16-select.md).

### Запросы

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn workspace examples.app-with-http start:dev

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
# {"error":"Subscription nope is not active on this node","code":"SUBSCRIPTION_NOT_FOUND","details":{"id":"nope"}}  404
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

## Что гарантирует фреймворк

- Класс-юниты слоя `tracked` регистрирует плагин. Endpoint с `tracked`
  в сборке без `appSubscriptions` останавливает старт на фазе ASSEMBLE:
  незарегистрированный класс-юнит не создаётся.
- Запись из реестра уходит только после закрытия потока. `abort` подаёт
  сигнал, а удаляет запись `.finally`, который для потоковой формы
  выполняется после завершения отдачи.
- Что слой стоит на каждом endpoint'е с подпиской, проверяется политикой
  `everyEndpoint({ pattern: /\/live$/ }).hasLayer(tracked)`, как в
  [главе 9](./09-auth.md). В примере такой политики нет: слой подключён
  на обоих `events`-endpoint'ах вручную.
- Пакет не тянет валидатор схем и не требует правок ядра. Схемы фактов
  аннотированы `jsonSchema()`, поэтому они попадают в документ OpenAPI и в
  снапшот совместимости из [главы 18](./18-compatibility.md).

## Как проверить

```typescript
// packages/examples.app-with-http/src/app.spec.ts
it('показывает подписку, завершает её и удаляет запись', async () => {
  await using testApp = await assembleTest(app, {
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

  unwrap(await createUser(app, 'subscriber'));
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
`SUBSCRIPTION_NOT_FOUND` и то, что лента реестра не видит собственного
`opened`.

```bash
yarn workspace examples.app-with-http test
```

## Пока не нужно

- Как пакет вроде `@nestling/subscriptions` пишется без правок ядра и
  что для этого должно быть публичным: [глава 25](./25-extending.md).
- Закрытие подписки в другом процессе. Реестр локален для узла, а
  наблюдение кластерное через факты. Тема отложена, см.
  [deferred.md](../decisions/deferred.md).

## Запускаемый код

- `packages/examples.app-with-http/src/app.ts` — плагин
  `appSubscriptions`.
- `packages/examples.app-with-http/src/features/users/endpoints/activity-stream.endpoint.ts`
  — подписка под слоем `tracked`.
- `packages/examples.app-with-http/src/features/ops/subscriptions.endpoint.ts`
  — список, завершение и лента реестра.
- `packages/examples.app-with-http/src/features/ops/subscription-facts.ts`
  — подписчики фактов.
- `packages/examples.app-with-http/src/features/ops/ops.feature.ts` —
  фича `ops`.
- `packages/examples.app-with-http/src/app.spec.ts` — `describe('реестр
  подписок')`.

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn workspace examples.app-with-http start:dev
curl -N localhost:3000/users/activity
curl localhost:3000/ops/subscriptions
```

## Дальше

Те же примитивы без `makeApp`: встраивание в чужой сервер и контейнер
без приложения, [глава 24](./24-standalone.md).
