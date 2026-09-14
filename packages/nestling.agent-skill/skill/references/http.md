# HTTP shape of a response

A handler returns a value or a failure, and neither of them carries a
header. Everything that belongs to HTTP and not to the result — a status
of success, headers, cookies, a redirect — is set by wrapping the result
in `HttpResponse`. Names live in the README of
[`@nestlingjs/transport.http`](https://www.npmjs.com/package/@nestlingjs/transport.http).

`HttpResponse` is allowed where the address is declared by the transport:
`httpEndpoint.<method>(path, { … })`. `httpEndpoint.implement` and
`implement` take a handler without HTTP in it, and a handler that has HTTP
in it does not compile there — the same operation is callable over a bus,
where a cookie means nothing.

## Success status

The status of a success belongs to the result, not to the transport: `Ok`
names it, and each transport maps the name to what it has. HTTP maps it to
a number.

| The handler returns | Status | HTTP |
|---|---|---|
| the value itself | `ok` | 200 |
| `Ok.created(value)` | `created` | 201 |
| `Ok.accepted(value)` | `accepted` | 202 |
| `Ok.noContent()` | `no_content` | 204 |

`status: 'created'` is a field of the declaration or of the operation, not
of `doc:`: the status is a contract of the answer, and one default serves
the runtime, the document and the client — `ok` with an `output`,
`no_content` without one. A bare value from the handler gets the declared
status.

Several outcomes with different bodies are declared by a fork in the
`output` slot: `outputs({ ok: User, created: User, no_content: none() })`.
A handler with a fork picks its outcome by returning `Ok.created(user)` or
`new Ok(user)`; a bare value no longer compiles.

## The server and the transport

A server is a declaration of its own and is **not** listed in
`transports:`. A transport names it in `server:`, and the build creates it
once for however many transports point at it; a server nobody names is
never created. A server put into `transports:` is rejected on the BUILD
phase, with the replacement in the message.

<!-- snippet: embedding.ts#server -->
```typescript
export const api = server();

export const served = makeApp({
  features: [UsersFeature],
  transports: [http({ server: api })],
});
```

The default instance name is `'default'`, and the config section is the
family `http` — `HTTP_PORT`, `HTTP_HOST`. `serverKeys()` gives the right to
bind a source to those keys.

## Inside a foreign process

`adapter()` is the transport without a socket: the `httpEndpoint`
declarations move over unchanged, and Next.js, Hono, Express or Fastify
owns the listening.

<!-- snippet: embedding.ts#embedded -->
```typescript
const embedded = makeApp({
  features: [UsersFeature],
  transports: [adapter()],
}).build();

await embedded.run({ signals: false });

const handler = toFetchHandler(embedded);

export const GET = handler;
export const POST = handler;
```

`toFetchHandler(app, { name })` gives `(Request) => Promise<Response>`;
`toNodeHandler(app, { name })` gives `(req, res) => Promise<boolean>`,
where `false` means the route is not the application's. `signals: false`
leaves `SIGTERM` and `SIGINT` to the owner of the process. Every io form
works either way: `value`, `stream`, `events`, `multipart`, `rawBody`.

## Headers and cookies

<!-- snippet: create-session.endpoint.ts#cookies -->
```typescript
const Session = z.object({ id: z.string(), expiresAt: z.string() });

/** How long a session cookie lives, in seconds */
const SESSION_TTL = 3600;

/**
 * `HttpResponse.of(result, { headers, cookies })` wraps the result of the
 * handler: `Ok.created` keeps the success status, and the options carry
 * what belongs to HTTP rather than to the value.
 *
 * `detached:` takes the endpoint out of the build policies and says why
 * in one sentence: this is the call that issues the token, so the `authed`
 * layer the root requires of every `POST` cannot run before it.
 */
export const CreateSession = httpEndpoint.post('/sessions', {
  input: z.object({ email: z.email() }),
  output: Session,
  status: 'created',
  pipeline: traced,
  detached: 'a session issues the token that the authed layer checks',
  doc: { summary: 'Open a session', tags: ['users'] },
  handler: async () => {
    const session = { id: 'sid-1', expiresAt: new Date().toISOString() };

    return HttpResponse.of(Ok.created(session), {
      headers: { location: `/sessions/${session.id}` },
      cookies: [
        {
          name: 'sid',
          value: session.id,
          path: '/',
          maxAge: SESSION_TTL,
          httpOnly: true,
          sameSite: 'lax',
        },
      ],
    });
  },
});
```

The first argument of `of` is either a bare value or an `Ok`, never a
failure: a failure is returned as it is, and its status comes from its
code.

Header names are lowercased before they are merged, so a header set here
wins over one the transport would have written whatever the case. Every
entry of `cookies` goes out as its own `Set-Cookie`; the fields are
`name`, `value`, `maxAge`, `expires`, `path`, `domain`, `secure`,
`httpOnly` and `sameSite`.

## The request side

There is no API for reading cookies and no decorator for a header. What the
request brought is in the second parameter of the handler, typed
`HttpHandlerMeta`:

<!-- snippet: request-meta.ts#meta -->
```typescript
async handle(input: Credentials, meta: HttpHandlerMeta) {
  const forwarded = meta.http.headers['x-forwarded-proto'];

  return { email: input.email, secure: forwarded === 'https' };
}
```

`meta.http` carries `method`, `url`, `headers` — names in lower case — and
`ip`. The same value is in the start context, so a `.pre` step sees it too:
authentication reads the header there once, and the handler takes a typed
field instead.

## Redirect

<!-- snippet: redirect.endpoint.ts -->
```typescript
import { traced } from './pipeline.js';

import { httpEndpoint, HttpResponse } from '@nestlingjs/transport.http';
import { z } from 'zod';

/**
 * A redirect is declared twice. The field `redirect:` says the endpoint
 * answers with a 3xx and gives the default status; the handler says where
 * to. Without the field the answer is `internal_error`, because the
 * declaration is what the transport and the OpenAPI document read.
 *
 * There is no `output:`: a 3xx carries no body.
 */
export const GetAvatar = httpEndpoint.get('/users/:id/avatar', {
  input: z.object({ id: z.string() }),
  redirect: 302,
  pipeline: traced,
  handler: async ({ id }) =>
    HttpResponse.redirect(`https://cdn.example.com/avatars/${id}.png`),
});
```

**The field `redirect:` is mandatory.** A handler that returns
`HttpResponse.redirect(…)` from a declaration without it answers
`internal_error`, and the text of the error names the endpoint and the
missing field. Nothing catches this at compile time: the declaration and
the handler are checked apart, and a redirect is a valid answer for a
declaration that expects one.

The status is taken from the call first — `HttpResponse.redirect(url, {
status: 307 })` — then from the field, then `302`. Headers and cookies go
with a redirect too: `HttpResponse.redirect(url, { cookies: [session] })`
is how a login answers.
