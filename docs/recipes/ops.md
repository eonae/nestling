# Кто сейчас подключён и как его отключить

> Гайд по текущему API; сверено с кодом `561d1000`.
> Целевое описание: [design/streaming.md](../design/streaming.md), раздел
> «4.1 Реестр подписок», и [design/composition.md](../design/composition.md)
> §6 «Узлы ядра: пробы и логгер». Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-08-01] Реестр подписок:
> результат dogfooding-замера» и «[2026-09-06] Пробы: `HealthCheck$` и
> `Health$` в ядре, транспорты адаптируют».

У сервиса есть лента по SSE из [главы 17](../guide/17-live-feed.md), и клиенты
держат её открытой часами. Эксплуатации нужно видеть список открытых
подписок этого процесса, закрывать зависшую подписку по идентификатору и
наблюдать открытия и закрытия в реальном времени. Хендлер ленты при этом
не должен знать, кто и зачем его закрыл.

Реестр подписок живёт в отдельном пакете `@nestlingjs/subscriptions`. Он
написан на публичных примитивах ядра и подключается как плагин; ядро о
нём не знает.

## Плагин в корне

```typescript
// src/app.ts (фрагмент)
import { everyEndpoint, RequestId } from '@nestlingjs/app';
import { makeSubscriptions } from '@nestlingjs/subscriptions';
// …

export const subscriptions = makeSubscriptions({
  identity: RequestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,
  node: 'api-1',
});

export const app = makeApp({
  features: [UsersFeature, NotificationsFeature, OpsFeature],
  plugins: [
    observability,
    auth,
    subscriptions,
    // …
  ],
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasVar(RequestId),
    // …
  ],
  // …
});
```

`makeSubscriptions(options)` возвращает плагин. Значение создаётся один раз и
перечисляется в `plugins:`, как параметризованный плагин из
[главы 14](../guide/14-features.md). Класс-шаги слоя подписок регистрирует
именно этот плагин: endpoint со слоем `tracked` в сборке без
`subscriptions` останавливает старт на фазе BUILD, потому что
незарегистрированный класс-шаг не создаётся.

Опции описывают решения композиции. `identity` называет подписчика
контекстной переменной: здесь это `RequestId` слоя `traced`, в
приложении с аутентификацией на её месте была бы переменная с
идентификатором пользователя. Реестр читает значение переменной по её
ключу и формы накопленного входа не знает.

Переменную кладёт пайплайн, поэтому на endpoint'е без неё запись
появилась бы без `identity` — молча. Это ловит политика
`everyEndpoint({ … }).hasVar(RequestId)`: промах останавливает сборку, а
не отдаёт пустой столбец в списке подписок.

Вторая форма `identity` — функция от контекста. Накопленный вход ей
недоступен: ключ из нескольких переменных собирает
`computed([TenantId, UserId], (_ctx, tenant, user) => …)` — оно читает
значения по ключам переменных и отдаёт их вычислению аргументами. Та же
форма работает и в `labels`, который добавляет метки к записи.

`publish: true` включает публикацию фактов открытия и закрытия
операциями (см. далее); по умолчанию она выключена. `node` называет
процесс в фактах.

## Слой `tracked` на endpoint'е подписки

```typescript
// src/features/users/endpoints/activity-stream.endpoint.ts
@Handler([ActivityHub])
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

export const ActivityStream = httpEndpoint.get('/users/activity', {
  output: events(ActivityEvent),
  sse: {
    id: (event) => event.id,
    event: (event) => event.kind,
  },
  doc: { summary: 'Лента активности (SSE)', tags: ['users'] },
  pipeline: compose(traced, tracked),
  handler: ActivityStreamHandler,
});
```

`tracked` — слой пайплайна из пакета. Его `.pre`-шаг регистрирует
подписку в реестре до вызова хендлера, а `.finally`-шаг снимает запись,
когда поток закрылся — независимо от того, сколько элементов клиент успел
прочитать. Слой добавляется через `compose`, как любой
сквозной слой из [главы 9](../guide/09-logging.md).

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
[главе 10](../guide/10-auth.md). В примере такой политики нет: слой подключён на
обоих `events`-endpoint'ах вручную.

## Endpoint'ы эксплуатации

Реестр инжектируется обычным DI-токеном `SubscriptionRegistry`.
Endpoint'ы лежат в фиче `ops`: у неё нет своих провайдеров,
наблюдаемость, аутентификация и реестр приходят плагинами.

```typescript
// src/features/ops/subscriptions.endpoint.ts
@Handler([SubscriptionRegistry])
class ListSubscriptionsHandler {
  constructor(private readonly registry: SubscriptionRegistry) {}

  async handle(): Output<Subscription[]> {
    return this.registry.list().map((info) => toWire(info));
  }
}

export const ListSubscriptions = httpEndpoint.get('/ops/subscriptions', {
  output: z.array(Subscription),
  doc: { summary: 'Активные подписки этого узла', tags: ['ops'] },
  pipeline: traced,
  handler: ListSubscriptionsHandler,
});
```

`registry.list()` отдаёт снимки записей: идентификатор, транспорт,
паттерн, вид формы, подписчика, метки, время старта и число отданных
элементов. `toWire` переводит снимок в схему ответа API.

```typescript
// src/features/ops/subscriptions.endpoint.ts
@Handler([SubscriptionRegistry])
class KillSubscriptionHandler {
  constructor(private readonly registry: SubscriptionRegistry) {}

  async handle(payload: {
    id: string;
  }): Output<null, typeof SubscriptionNotFound> {
    const killed = this.registry.abort(payload.id, 'administrative kill');

    return killed ? Ok.noContent() : SubscriptionNotFound({ id: payload.id });
  }
}

export const KillSubscription = httpEndpoint.delete('/ops/subscriptions/:id', {
  input: z.object({ id: z.string() }),
  errors: [SubscriptionNotFound],
  status: 'no_content',
  doc: { summary: 'Завершить подписку', tags: ['ops'] },
  pipeline: authed,
  handler: KillSubscriptionHandler,
});
```

`registry.abort(id, reason)` взводит сигнал администратора и возвращает
`false`, если записи нет. Запись из реестра при этом не удаляется: её
снимет `.finally` слоя `tracked`, когда поток действительно закроется.
Реестр отражает факт, а не опережает его. Endpoint стоит под слоем
`authed`: удалять чужие подписки может только тот, кто предъявил
Bearer-токен.

```typescript
// src/features/ops/subscriptions.endpoint.ts (фрагмент)
@Handler([SubscriptionRegistry])
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

export const WatchSubscriptions = httpEndpoint.get('/ops/subscriptions/live', {
  output: events(SubscriptionChange),
  sse: {
    id: (change) => change.subscription.id,
    event: (change) => change.type,
  },
  doc: { summary: 'Лента изменений реестра подписок (SSE)', tags: ['ops'] },
  pipeline: compose(traced, tracked),
  handler: WatchSubscriptionsHandler,
});
```

`registry.watch(signal)` отдаёт `AsyncIterable` событий `opened` и
`closed`. Лента сама является подпиской: она композирована от `tracked`
и видна в собственном списке. Своё событие `opened` она не получает: оно
опубликовано до вызова хендлера, то есть до того, как хендлер подписался.

## Факты открытия и закрытия

```typescript
// src/features/ops/subscription-facts.ts (фрагмент)
@Handler([Logger$.auto])
class SubscriptionOpenedInOpsHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: {
    node?: string;
    id: string;
    transport: string;
    pattern: string;
  }) {
    this.logger.info('subscription opened', {
      node: payload.node ?? 'local',
      id: payload.id,
      transport: payload.transport,
      pattern: payload.pattern,
    });
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
[главы 15](../guide/15-events.md). Фича `ops` подписана на оба через
`implement` с именем подписчика; реализация `SubscriptionClosedInOps`
устроена так же. Реестр локален для процесса, а факты уходят на шину: в
split-развёртывании из [главы 20](../guide/20-split.md) один процесс собирает
картину по всем узлам, и поле `node` говорит, где подписка открыта.
Закрыть подписку в другом процессе через `abort` нельзя.

Пакет не тянет валидатор схем и не требует правок ядра: схемы фактов
аннотированы `jsonSchema()`, поэтому они попадают в документ OpenAPI и в
снапшот совместимости из [главы 21](../guide/21-compatibility.md).

## Пробы: плагин в корне, вклады в модулях

Кроме реестра подписок эксплуатации нужны две пробы: балансировщик
спрашивает, жив ли процесс, а оркестратор — готов ли он принимать трафик.
Своими руками их писать не нужно: состояние приложения собирает узел ядра
`Health$`, а адреса и коды ответа даёт плагин HTTP-транспорта.

```typescript
// src/app.ts (фрагмент)
import { http, makeHttpProbes } from '@nestlingjs/transport.http';

export const app = makeApp({
  features: [UsersFeature, NotificationsFeature, OpsFeature],
  plugins: [observability, auth, subscriptions, makeHttpProbes(), …],
  transports: [http({ server: api }), …],
});
```

Плагин объявляет два endpoint'а — `GET /healthz` и `GET /readyz`. Оба без
пайплайна, оба `detached` и `doc.hidden` с причиной, как в
[главе 10](../guide/10-auth.md): политика «у каждого HTTP-endpoint'а есть слой
наблюдаемости» их не роняет, а причина печатается на старте и попадает в
отчёт `check()`. Провайдеров плагин не объявляет: узел `Health$` уже в
графе у любого приложения. Пути меняются опциями —
`makeHttpProbes({ liveness: '/live', readiness: '/ready' })`.

`GET /healthz` отвечает 200, пока процесс отвечает вообще: проверок он не
запускает. Вставший event loop не ответит в любом случае, а отвалившуюся
базу перезапуском процесса не чинят.

`GET /readyz` отвечает отчётом: фаза, исходы проверок, итог. Итог `ready`
только в фазе RUN и только если все критичные проверки прошли — до RUN и
на SHUTDOWN итог `not_ready`, и проверки не запускаются. Поэтому после
`SIGTERM` проба становится красной сразу, и балансировщик перестаёт слать
запросы в дренаж раньше, чем закроется первый сокет.

Вклад в отчёт — обычный провайдер токена семейства `HealthCheck$` в том
модуле, которому он принадлежит (рецепт [«Зависимости по имени и сбор
вкладов из модулей»](./token-families.md)); у
ресурса достаточно метода `health(signal)`. Приложение без единого вклада
собирается, а список проверок пуст.

Отдельной пробы старта нет: провал INIT завершает процесс, и отличать
«ещё стартует» от «упал» некому.

Фича `ops` остаётся фичей эксплуатации — реестр подписок и его факты.
Своих провайдеров у неё нет, `providers: []`. Она входит в любую
топологию и выбирается явно, как показывает [глава 19](../guide/19-select.md).

## Запросы

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn start:dev

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
# {"type":"urn:error:not_found:subscription","title":"Not Found","status":404,
#  "detail":"Subscription nope is not active on this node","details":{"id":"nope"}}  404

curl localhost:3000/healthz
# {"status":"ok"}

curl localhost:3000/readyz
# {"status":"ready","phase":"RUN","checks":[]}
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
2026-09-06T12:00:00.000Z INFO  SubscriptionOpenedInOpsHandler subscription opened node=api-1 id=86cc… transport=http pattern=GET /users/activity
2026-09-06T12:00:00.001Z INFO  SubscriptionClosedInOpsHandler subscription closed node=api-1 id=86cc… reason=killed itemsOut=1
```

## Проверка

```typescript
// src/app.spec.ts
it('показывает подписку, завершает её и удаляет запись', async () => {
  await using testApp = await buildTest(app, {
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
yarn test
```

Те же примитивы без `makeApp`: встраивание в чужой сервер и контейнер
без приложения — рецепт [«Без `makeApp`»](./standalone.md).
