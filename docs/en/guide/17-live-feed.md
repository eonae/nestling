# 17. A live feed for the client

> Guide to the current API; verified against `02d6b233`.
> Target description: [design/streaming.md](../design/streaming.md), the
> "`stream(T)` and `events(T)` " and "Event sources" sections. Why: entry
> [ideas.md](../../decisions/ideas.md)
> `[2026-07-06] Стриминг: stream(T) ≠ events(T), AbortSignal, источники событий`.

The client wants to see new users right away, with no polling of the
list. The connection lives long and closes when the client leaves, and
that is not an error. After a disconnect the client must continue from
the event where it stopped. One slow client must not hold back the
rest.

## The event source

```typescript
// src/features/users/activity.hub.ts (fragment)
@Resource([])
export class ActivityHub {
  static async acquire(_signal: AbortSignal): Promise<ActivityHub> {
    return new ActivityHub();
  }

  readonly #topic = new Topic<ActivityEvent>({ buffer: 256 });

  /** The latest events: a subscription continues from them after a reconnect */
  readonly #history: ActivityEvent[] = [];

  #sequence = 0;

  /** Publishes an event: the call does not wait for a single subscriber */
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
  /** When the application stops, every subscription finishes normally */
  release(): void {
    this.#topic.close();
  }
}
```

The event source is a resource: closing the `Topic` and finishing the
open subscriptions is possible only by an explicit call on stop, and
that call is `release`. Inside it is a `Topic` from
`@nestlingjs/operations`: a source with any number of subscribers.
`push` does not wait for a single subscriber and returns at once.
`subscribe(signal)` returns an `AsyncIterableIterator` that finishes
when `signal` fires, when `close()` is called, and when the consumer
exits the iteration. Every subscription has its own buffer, so a slow
client does not hold back the rest.

The hub keeps the latest events to give back what was missed after a
reconnect: `subscribe` first yields the history with an identifier
greater than `since`, then the live events. `release` closes the topic
when the application stops, and every subscription finishes in the
standard way.

`Topic` accepts the `buffer` option: the buffer size per subscriber,
`1024` by default, `0` turns buffering off. The `onSlowConsumer` option
sets the behaviour when a subscriber's buffer overflows. With
`drop-oldest` (the default value) the oldest event of the lagging
subscriber is dropped, and the subscription keeps working. With
`disconnect` the lagging subscription ends. The other subscribers are
not affected in either case. The example's hub keeps a buffer of 256
events with the default policy.

## An endpoint with the `events` shape

```typescript
// src/features/users/endpoints/activity-stream.endpoint.ts
const ActivityEvent = z.object({
  id: z.string(),
  kind: z.enum(['created', 'updated', 'deleted']),
  userId: z.string(),
  at: z.string(),
});

type ActivityEvent = z.infer<typeof ActivityEvent>;

@Handler([ActivityHub])
class ActivityStreamHandler {
  constructor(private readonly hub: ActivityHub) {}

  async handle(
    _payload: unknown,
    meta: { subscription: TrackedSubscription; lastEventId?: string },
  ): Output<AsyncIterable<ActivityEvent>> {
    // A real feed would give back history from this point
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
  pipeline: compose(observability, tracked),
  handler: ActivityStreamHandler,
});
```

`events(T)` is the io shape for an open subscription. It differs from
`stream(T)` from [chapter 12](./12-files-and-streams.md):

| | `stream(T)` | `events(T)` |
|---|---|---|
| Nature | finite data | open subscription |
| End | the data ran out | the client disconnected |
| HTTP | NDJSON | SSE |
| Normal outcome | `completed` | `disconnected` |

The handler is called once per connection and returns an
`AsyncIterable`. The transport gives out the elements as SSE frames. It
closes the iterator on the client's disconnect and on the
application's stop: the subscription comes off the topic, and the
buffer is freed. The `sse:` section sets the frame's fields: `id` lands
in the `id:` line, `event` in the `event:` line. A client that
reconnected sends the `Last-Event-ID` header, and the transport puts it
into `meta.lastEventId` as an already typed field, so the header does
not need to be read from the raw request. Where to continue from is
the handler's decision.

The `tracked` layer from the `@nestlingjs/subscriptions` package
registers the subscription in the registry and gives the handler
`meta.subscription.signal`. This signal combines the request's signal
with the administrative cancel from the registry, so the handler
listens only to it.

For a streamed response the `.finally` steps of the `observability`
layer run after the stream has ended, broken off, or been closed, so
the outcome is honest: a client's disconnect gives `disconnected`, a
source that ended on its own gives `completed`, a failure gives
`failed`. A client leaving before the first event also counts as a
close: `.finally` runs, and `ctx.summary.itemsOut` stays zero. A
failure in the middle of the stream reaches the client as a named
`error` event, and the connection closes. The name `error` is
reserved: an application event with this name is rejected when the
declaration is created.

## Publishing from the handler

```typescript
// src/features/users/endpoints/create-user.endpoint.ts (fragment)
    // The activity feed: `publish` does not wait for a single
    // subscriber
    this.activity.publish('created', user.id);

    // The 201 status is set on a successful response
    return Ok.created(user);
```

`ActivityHub` is injected into the registration handler through the
`@Handler` dependency list, like any provider. The publish does not
slow down the creation of a user by even one connected client.

## What the client sees

Open the feed in one terminal and create a user in another:

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn start:dev
curl -N localhost:3000/users/activity
```

```bash
curl -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"User 1","email":"user1@example.com"}'
```

The first terminal gets a frame:

```
id: 1
event: created
data: {"id":"1","kind":"created","userId":"3","at":"2026-09-03T04:34:57.017Z"}
```

Interrupt `curl` and connect again with the reconnect header:

```bash
curl -N localhost:3000/users/activity -H 'Last-Event-ID: 2'
```

The feed starts with event `3`: the handler got `meta.lastEventId` and
gave back the history after it.

An e2e test on a real socket checks the SSE frames:

```typescript
// e2e/streaming.spec.e2e.ts
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

In an app test, `testApp.call(ActivityStream)` returns a response
whose `value` is an `AsyncIterableIterator`: the test reads events
through `next()` with no transport. The subscription registry's tests
in `app.spec.ts` are built the same way.

The `users` feature depends on the mailing, but a feature's test must not
bring up the neighbour: [18. Test a feature without its
neighbours](./18-testing-features.md).
