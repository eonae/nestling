# 13. Живая лента для клиента

> Гайд по текущему API; сверено с кодом `examples.app-with-http` (2026-09-03).
> Целевое описание: [design/streaming.md](../design/streaming.md), разделы
> «`stream(T)` и `events(T)`» и «Источники событий». Почему так: запись
> [ideas.md](../decisions/ideas.md) «[2026-07-06] Стриминг: `stream(T)` ≠
> `events(T)`, AbortSignal, источники событий».

## Задача

Клиент хочет видеть новых пользователей сразу, без опроса списка.
Соединение живёт долго и закрывается, когда клиент уходит, и это не
ошибка. После обрыва клиент должен продолжить с того события, на котором
остановился. Один медленный клиент не должен задерживать остальных.

## Решение

### Шаг 1. Источник событий

```typescript
// packages/examples.app-with-http/src/features/users/activity.hub.ts
@Injectable([])
export class ActivityHub {
  readonly #topic = new Topic<ActivityEvent>({ buffer: 256 });

  /** Последние события: с них продолжается подписка после реконнекта */
  readonly #history: ActivityEvent[] = [];

  #sequence = 0;

  /** Публикует событие; вызов не ждёт ни одного подписчика */
  publish(kind: ActivityEvent['kind'], userId: string): void {
    this.#sequence += 1;

    const event: ActivityEvent = {
      id: String(this.#sequence),
      kind,
      userId,
      at: new Date().toISOString(),
    };

    this.#history.push(event);
    if (this.#history.length > HISTORY_SIZE) {
      this.#history.shift();
    }

    this.#topic.push(event);
  }

  async *subscribe(
    signal?: AbortSignal,
    since = '0',
  ): AsyncIterableIterator<ActivityEvent> {
    const live = this.#topic.subscribe(signal);
    let last = Number(since);

    for (const event of this.#history) {
      if (Number(event.id) > last) {
        last = Number(event.id);
        yield event;
      }
    }

    for await (const event of live) {
      if (Number(event.id) > last) {
        last = Number(event.id);
        yield event;
      }
    }
  }
  // …
  /** При остановке приложения все подписки завершаются нормально */
  @OnDestroy()
  close(): void {
    this.#topic.close();
  }
}
```

Источник событий — обычный провайдер. Внутри него `Topic` из
`@nestling/streams`: источник с любым числом подписчиков. `push` не ждёт
ни одного подписчика и возвращается сразу. `subscribe(signal)` возвращает
`AsyncIterableIterator`, который завершается, когда взведён `signal`,
когда вызван `close()` и когда потребитель выходит из итерации. У каждой
подписки свой буфер.

Хаб хранит последние события, чтобы после реконнекта отдать пропущенное:
`subscribe` сначала выдаёт историю с идентификатором больше `since`,
затем живые события. Хук `@OnDestroy` закрывает тему при остановке
приложения, и все подписки завершаются штатно.

### Шаг 2. Endpoint с формой `events`

```typescript
// packages/examples.app-with-http/src/features/users/endpoints/activity-stream.endpoint.ts
const ActivityEvent = z.object({
  id: z.string(),
  kind: z.enum(['created', 'updated', 'deleted']),
  userId: z.string(),
  at: z.string(),
});

type ActivityEvent = z.infer<typeof ActivityEvent>;

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

`events(T)` — форма io для открытой подписки. Она отличается от
`stream(T)` из [главы 10](./10-files-and-streams.md):

| | `stream(T)` | `events(T)` |
|---|---|---|
| Природа | конечные данные | открытая подписка |
| Конец | данные закончились | клиент отключился |
| HTTP | NDJSON | SSE |
| Нормальный исход | `completed` | `disconnected` |

Хендлер вызывается один раз на соединение и возвращает `AsyncIterable`.
Транспорт отдаёт элементы кадрами SSE. Секция `sse:` задаёт поля кадра:
`id` попадает в строку `id:`, `event` в строку `event:`. Клиент, который
переподключился, присылает заголовок `Last-Event-ID`, и транспорт кладёт
его в `meta.lastEventId` уже типизированным. Откуда продолжить, решает
хендлер.

Слой `tracked` из пакета `@nestling/subscriptions` регистрирует подписку
в реестре и даёт хендлеру `meta.subscription.signal`. Этот сигнал
объединяет сигнал запроса с административной отменой из реестра, поэтому
хендлер слушает только его. Реестр описан в [главе 23](./23-ops.md).

Юниты `.finally` слоя `observability` для потокового ответа выполняются
после того, как поток закончился или оборвался. Отключение клиента даёт
исход `disconnected`, и строка аудита пишется с ним.

### Шаг 3. Публикация из хендлера

```typescript
// packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts
    // Лента активности: `publish` не ждёт ни одного подписчика
    activity.publish('created', user.id);

    // Статус 201 и заголовок задаются на успешном ответе
    return Ok.created(user, { Location: `/users/${user.id}` });
```

`ActivityHub` инжектируется в хендлер регистрации через `deps`, как
любой провайдер. Публикация не замедляет создание пользователя ни на
одного подключённого клиента.

### Шаг 4. Медленный подписчик

`Topic` принимает две опции.

| Опция | Что делает |
|---|---|
| `buffer` | размер буфера на одного подписчика, по умолчанию `1024`; `0` отключает буферизацию |
| `onSlowConsumer` | что делать при переполнении буфера подписчика: `'drop-oldest'` по умолчанию или `'disconnect'` |

При `drop-oldest` самое старое событие отстающего подписчика
выбрасывается, и подписка продолжает работать. При `disconnect` подписка
отстающего завершается. Остальные подписчики в обоих случаях не
затронуты. Хаб примера держит буфер на 256 событий с политикой по
умолчанию.

### Что видит клиент

Откройте ленту в одном терминале и создайте пользователя в другом:

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn workspace examples.app-with-http start:dev
curl -N localhost:3000/users/activity
```

```bash
curl -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"User 1","email":"user1@example.com"}'
```

Первый терминал получает кадр:

```
id: 1
event: created
data: {"id":"1","kind":"created","userId":"3","at":"2026-09-03T04:34:57.017Z"}
```

Прервите `curl` и подключитесь снова с заголовком реконнекта:

```bash
curl -N localhost:3000/users/activity -H 'Last-Event-ID: 2'
```

Лента начнётся с события `3`: хендлер получил `meta.lastEventId` и
отдал историю после него.

## Что гарантирует фреймворк

- Для потокового ответа `.finally` выполняется после завершения потока,
  поэтому исход честен: `disconnected` при отключении клиента,
  `completed`, если источник закончился сам, `failed` при отказе.
- Транспорт закрывает итератор при отключении клиента и при остановке
  приложения. Подписка снимается с темы, буфер освобождается.
- Отказ посреди потока приходит клиенту именованным событием `error`, и
  соединение закрывается. Имя `error` зарезервировано: прикладное
  событие с таким именем отвергается при создании декларации.
- Значение `meta.lastEventId` типизировано: заголовок не нужно читать из
  сырого запроса.

## Как проверить

```typescript
// packages/examples.app-with-http/e2e/streaming.spec.e2e.ts
it('отдаёт событие создания по SSE', async () => {
  const controller = new AbortController();
  const feed = await fetch(`${context.baseUrl}/users/activity`, {
    signal: controller.signal,
  });
  expect(feed.status).toBe(200);
  expect(feed.headers.get('content-type')).toContain('text/event-stream');

  const created = await client.json(
    'POST',
    '/users',
    { name: 'Streamed', email: 'streamed@example.com' },
    { auth: true },
  );
  expect(created.status).toBe(201);

  if (!feed.body) {
    throw new Error('SSE response has no body');
  }

  const reader = feed.body.getReader();
  const { value } = await reader.read();
  const frame = new TextDecoder().decode(value);

  expect(frame).toContain('event: created');
  expect(frame).toContain('"kind":"created"');

  controller.abort();
});
```

Кадры SSE проверяет e2e-тест на настоящем сокете. В app-тесте
`testApp.call(ActivityStream)` возвращает ответ, у которого `value` является
`AsyncIterableIterator`: тест читает события через `next()` без
транспорта. Так устроены тесты реестра подписок в `app.spec.ts`.

## Пока не нужно

- Список открытых подписок, их принудительное закрытие и факты открытия
  и закрытия: [глава 23](./23-ops.md).
- Окна по времени, слияние источников и другие мостики к RxJS: раздел
  «Граница с RxJS» в [design/streaming.md](../design/streaming.md).

## Запускаемый код

- `packages/examples.app-with-http/src/features/users/activity.hub.ts` —
  источник событий поверх `Topic`.
- `packages/examples.app-with-http/src/features/users/endpoints/activity-stream.endpoint.ts`
  — endpoint с формой `events` и секцией `sse`.
- `packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts`
  — публикация в ленту.
- `packages/examples.app-with-http/e2e/streaming.spec.e2e.ts` — тест
  кадра SSE.

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn workspace examples.app-with-http start:dev
curl -N localhost:3000/users/activity
curl -N localhost:3000/users/activity -H 'Last-Event-ID: 2'
```

## Дальше

Фича `users` зависит от квот, но тест фичи не должен поднимать соседа:
[15. Тестировать фичу без соседей](./15-testing-features.md).
