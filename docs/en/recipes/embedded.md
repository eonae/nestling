# An application inside a foreign process

> Guide to the current API; verified against `d4cababb` (2026-09-14).
> Target description: [design/transports.md](../design/transports.md) §4.3,
> [design/composition.md](../design/composition.md) §1. Rationale: the
> entry [ideas.md](../../decisions/ideas.md)
> `[2026-09-12] Разбор обзоров d/10 и d/13`, point 4.

Someone else owns the process: Next.js, Express or a test run opens the
socket. The Nestling application stays whole — features, container,
phases — but opens no socket and hands the request handler out.

The `adapter()` transport gives it. It is declared instead of `http()`,
with the same instance name and the same parsing options. The
`httpEndpoint` declarations move onto it without a single edit.

## A Next.js route

```typescript
// src/app/api/[[...path]]/route.ts
import { adapter, toFetchHandler } from '@nestlingjs/transport.http';

const app = makeApp({
  features: [Users],
  transports: [adapter()],
}).assemble();

await app.run({ signals: false });

const handler = toFetchHandler(app);

export const GET = handler;
export const POST = handler;
```

`toFetchHandler(app, { name? })` returns `(request: Request) =>
Promise<Response>` — exactly the shape the routes of Next.js, Hono and
Elysia expect. The function is synchronous: it takes the ready adapter
instance from the `app.transports` map and returns its handler.

A request that matches no pattern of the declarations gets a `404`. The
application serves the paths its endpoints declared, and stripping the
mount prefix (`/api`) is the job of the process owner.

All io shapes work: `value`, `stream`, `events`, `multipart` and
`rawBody`. A streaming response comes back as soon as the status is
known, so a `Response` with a streaming body is available to the caller
before the stream ends.

## An Express route

```typescript
// src/server.ts
import { adapter, toNodeHandler } from '@nestlingjs/transport.http';

const app = makeApp({
  features: [Users],
  transports: [adapter()],
}).assemble();

await app.run({ signals: false });

const handler = toNodeHandler(app);

server.use((request, response, next) => {
  // `false` means "not the application's route": the owner's own routing
  // continues from here
  void handler(request, response).then((taken) => {
    if (!taken) {
      next();
    }
  });
});
```

`toNodeHandler(app, { name? })` returns `(req, res) =>
Promise<boolean>`. The `false` flag is what tells this shape apart from
`fetch`: the response has not been sent, the request is free, and the
owner continues its chain. The other half of an application on Fastify
and on bare `node:http` works the same way.

## Startup and shutdown

The process owner starts and stops the application. There is no hidden
startup on the first request: before `run()` there is no handler, and
both functions refuse with a message that names `run()`.

```typescript
await app.run({ signals: false });

// … and where the owner finishes its work
await app.close();
```

**`signals: false` is required for an embedded application.** Without the
option `run()` subscribes to `SIGTERM` and `SIGINT`, and a subscription
to `SIGINT` cancels the shutdown of the foreign process on Ctrl+C. The
remaining phases go the same way at any value of the option.

## The client address

The `fetch` shape has no socket, so `ctx.http.ip` is empty. The client
address arrives in a header from whoever stands in front of the process:

```typescript
pipeline: makePipeline().pre(withClientIp),
```

The `withClientIp` unit reads `x-forwarded-for` and puts the address into
the request context. On the `node:http` shape both paths are available:
the socket address and the header.

## Boundaries

A runtime other than Node is not part of the package. The `multipart`
parsing goes through `busboy`, the body is collected into a `Buffer`, and
the source of the `fetch` shape wraps the request body into a
`node:stream` stream. A build for Workers or Deno stays a separate piece
of work.

An application without `makeApp` is a different task, and other
primitives solve it: [«Without `makeApp`»](./standalone.md) assembles the
transport, the server and the `dispatch` by hand, without the phases and
the container of an application.
