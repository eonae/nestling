# Webhook with a signature check

> Guide to the current API; verified against `5e9f05b0`.
> Target description: [design/endpoints.md](../design/endpoints.md), the "Raw
> bytes: `rawBody` " section. Rationale: the entry
> [ideas.md](../../decisions/ideas.md)
> `[2026-07-13] Канонизация HTTP-input: канон размещения + bind-карта`.

An external system sends user events to `POST /hooks/users` and signs
the body with an HMAC signature in the `x-signature` header. The
signature must be checked against the raw bytes of the body: a JSON
re-serialized from the parsed value gives a different signature. The
handler must still receive the payload parsed and checked by the
schema, like any other endpoint. The external system has no Bearer
token, so the policy "every `POST` checks a Bearer token" from
[chapter 10](../guide/10-auth.md) does not apply to this endpoint.

## The failure and the signature secret

```typescript
// src/features/users/users.errors.ts
export const InvalidSignature = makeFail('unauthorized:invalid_signature', {
  message: 'Webhook signature does not match the body',
});
```

The failure is declared the same way as the feature's other failures.
The transport translates the `unauthorized` status into `401`.

```typescript
// src/app.config.ts (fragment)
export const AppConfig = makeConfig('app', {
  // …
  webhookSecret: secret(from('WEBHOOK_SECRET', z.string().min(1))),
});
```

The secret is read from `WEBHOOK_SECRET`. The field is required:
without it, the application does not start. `secret()` hides the value
when the section is printed and in error text, as in
[chapter 7](../guide/07-config.md).

## A pre-step that checks the signature

```typescript
// src/features/users/endpoints/user-webhook.endpoint.ts (fragment)
import { createHmac, timingSafeEqual } from 'node:crypto';
// …

@Handler([AppConfig])
export class VerifySignature {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  handle(ctx: ExtendableContext<{ rawBody: Uint8Array }>): void {
    const provided = String(ctx.raw.attributes['x-signature'] ?? '');
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(ctx.input.rawBody)
      .digest('hex');

    const matches =
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

    if (!matches) {
      throw InvalidSignature();
    }
  }
}
```

`VerifySignature` is built the same way as `Authenticate` from
[chapter 10](../guide/10-auth.md): a class step with a dependency on
the config section, registered in the `providers:` of the
`UsersModule` module.

The difference is in the context type.
`ExtendableContext<{ rawBody: Uint8Array }>` declares that the step
needs the raw bytes of the body in `ctx.input.rawBody`. The transport
puts this field there before the first pre-step, if the declaration is
marked `rawBody: true`. Without the mark the field does not exist, and
such a step does not fit into the pipeline — the compiler makes the
check.

The step reads the signature header from `ctx.raw.attributes`. The
comparison runs through `timingSafeEqual`, so the response time does
not depend on which byte of the signature differs. On a mismatch, the
step throws the failure, and the handler is not called.

## A declaration with `rawBody: true`

```typescript
// src/features/users/endpoints/user-webhook.endpoint.ts
@Handler([UsersRepository$])
class UserWebhookHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(event: UserEventInput): Output<UserEventOutput> {
    await this.users.remove(event.userId);

    return { received: true };
  }
}

export const UserWebhook = httpEndpoint.post('/hooks/users', {
  input: UserEventInput,
  output: UserEventOutput,
  errors: [InvalidSignature],
  rawBody: true,
  detached:
    'webhook: подлинность проверяется подписью тела, а не Bearer-токеном',
  doc: { summary: 'Webhook о событиях пользователя', tags: ['users'] },
  // The layer with a requirement on the start context stands outside:
  // the transport meets its requirement, not a neighbouring layer
  pipeline: compose(
    makePipeline<{ rawBody: Uint8Array }>().pre(VerifySignature),
    traced,
  ),
  handler: UserWebhookHandler,
});
```

`rawBody: true` turns on access to the bytes of the body. The transport
reads the body once: the same bytes go into `ctx.input.rawBody` for the
step and are parsed into JSON for the `input` schema, so there can be
no gap between the signed bytes and the checked value. The handler
receives an ordinary checked payload and knows nothing about the
bytes.

`makePipeline<{ rawBody: Uint8Array }>()` declares the layer's
requirement on the start context. The layer stands as the first
argument of `compose`: the transport meets its requirement, and there
is no outer layer that would put `rawBody` there. The `traced`
layer stands second and receives the context in which the signature is
already checked. A layer with such a requirement on a declaration
without `rawBody: true` does not compile, and the type error names the
missing field and how to fix it:

```
__error: "Pipeline requires context that the start context does not provide";
missing: { rawBody: Uint8Array };
hint: "declare 'rawBody: true', or provide the fields from an outer layer"
```

A forgotten mark is caught in the editor, not by a request answering
`500`.

`errors: [InvalidSignature]` declares the failure thrown by the step,
not the handler. The rule from [chapter 10](../guide/10-auth.md)
applies here too: the `errors:` list describes everything the client
can receive, and a failure from a pre-step passes the same check as a
failure from the handler. An undeclared failure would reach the client
as `internal_error`.

`detached` takes the endpoint out from under every build policy
with a reason, and requires one: an empty string stops the build.
The policy from `app.ts` requires the `authed` layer from every
`POST`, and here the signature confirms authenticity instead. The
reason is printed at start and appears in the `check()` report, so the
list of policy exceptions can be read at review:

```
[nestling] detached from policies: POST /hooks/users (http) — webhook: подлинность проверяется подписью тела, а не Bearer-токеном
```

## Requests and checking

The signature is computed by the same algorithm as in the step:
HMAC-SHA256 of the body's bytes, in hex.

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn start:dev

body='{"type":"user.deleted","userId":"2"}'
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac hook | sed 's/^.* //')

curl -X POST localhost:3000/hooks/users \
  -H 'content-type: application/json' -H "x-signature: $sig" -d "$body"
# {"received":true}                                                 200

curl -X POST localhost:3000/hooks/users \
  -H 'content-type: application/json' -H 'x-signature: deadbeef' -d "$body"
# {"type":"urn:error:unauthorized:invalid_signature","title":"Unauthorized","status":401,
#  "detail":"Webhook signature does not match the body"}                 401

curl localhost:3000/users/2
# {"type":"urn:error:not_found:user","title":"Not Found","status":404,
#  "detail":"User 2 not found","details":{"id":"2"}}                      404
```

The first request passed the check, and the handler removed the user.
The second was rejected by the step before the handler. The
`traced` layer's audit line is present in both cases: the layer
stands inside and sees the outcome of the request.

Checking the signature depends on the bytes of the body, so the test
goes over the network, not through `testApp.call`: an app test accepts
a ready payload and does not serialize the body.

```typescript
// e2e/webhook.spec.e2e.ts (fragment)
const sign = (body: string, secret = E2E_WEBHOOK_SECRET): string =>
  createHmac('sha256', secret).update(body).digest('hex');

// …
it('принимает тело с верной подписью и применяет событие', async () => {
  const body = JSON.stringify({ type: 'user.deleted', userId: '2' });

  const response = await client.raw('POST', '/hooks/users', body, {
    'content-type': 'application/json',
    'x-signature': sign(body),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true });
  const deleted = await client.get('/users/2');
  expect(deleted.status).toBe(404);
});

it('отклоняет тело с чужой подписью', async () => {
  const body = JSON.stringify({ type: 'user.deleted', userId: '1' });

  const response = await client.raw('POST', '/hooks/users', body, {
    'content-type': 'application/json',
    'x-signature': sign(body, 'wrong-secret'),
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({
    type: 'urn:error:unauthorized:invalid_signature',
  });
  const kept = await client.get('/users/1');
  expect(kept.status).toBe(200);
});
```

The secret in the e2e build is bound by a source to the section's
keys (`e2e/helpers/test-app.ts`); the test does not touch
`process.env`.

```bash
yarn test:e2e
```

The same declarations and pipeline work from the command line too —
the recipe [A CLI tool on the same primitives](./cli.md).
