# Failures

A failure is a value with a machine-readable code, not an exception class.
The handler returns it, the endpoint declares it, and the transport turns
the code into a status. Names live in the README of
[`@nestlingjs/operations`](https://www.npmjs.com/package/@nestlingjs/operations).

## Defining one

<!-- snippet: errors.ts -->
```typescript
import { makeFail } from '@nestlingjs/operations';
import { z } from 'zod';

/**
 * A failure definition. The code is `category[:refinement]`: the first
 * segment comes from a closed list and decides the HTTP status, the rest
 * refines it for the caller.
 */
export const UserNotFound = makeFail('not_found:user', {
  details: z.object({ id: z.string() }),
  message: (d) => `User ${d.id} not found`,
});

export const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} already taken`,
});

/** Details are optional: without them the definition takes no argument */
export const Unauthorized = makeFail('unauthorized', {
  message: 'Bearer token is missing or invalid',
});
```

The code is `category[:refinement]`. The category is the first segment,
comes from a closed list and decides how to answer; the refinement says
what happened and is what a client branches on. Every segment matches
`[a-z_]+`, and a code of a bare category is allowed.

| Category | HTTP | Category | HTTP |
|---|---|---|---|
| `bad_request` | 400 | `payload_too_large` | 413 |
| `unauthorized` | 401 | `too_many_requests` | 429 |
| `payment_required` | 402 | `internal_error` | 500 |
| `forbidden` | 403 | `not_implemented` | 501 |
| `not_found` | 404 | `service_unavailable` | 503 |
| `conflict` | 409 | `timeout` | 504 |

`details` is a schema, so the payload of a failure is typed on both sides,
and `message` is for a human reading a log. A definition is a function:
`UserNotFound({ id })` builds the failure, `UserNotFound.is(value)`
recognises it, `UserNotFound.code` is the string.

## Returning one

<!-- snippet: create-user.endpoint.ts -->
```typescript
import type { CreateUserInput, User } from './api-operations.js';
import { CreateUser as CreateUserOperation } from './api-operations.js';
import { EmailTaken } from './errors.js';
import type { QuotaExceeded } from './intercom-operations.js';
import { ClaimQuota } from './intercom-operations.js';
import { authed } from './pipeline.js';
import type { UsersRepository } from './users.repository.js';
import { UsersRepository$ } from './users.repository.js';

import type { Output, Port } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { Ok } from '@nestlingjs/operations';
import { httpEndpoint } from '@nestlingjs/transport.http';

@Handler([UsersRepository$, ClaimQuota.caller])
class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly quotas: Port<typeof ClaimQuota>,
  ) {}

  /**
   * `Output<Value, Failures>` lists every failure this handler may return.
   * A failure outside `errors:` of the endpoint becomes `internal_error`.
   */
  async handle(
    payload: CreateUserInput,
  ): Output<User, typeof EmailTaken | typeof QuotaExceeded, 'created'> {
    if (await this.users.byEmail(payload.email)) {
      return EmailTaken({ email: payload.email });
    }

    const claimed = await this.quotas.call({ email: payload.email });

    if (claimed.isFail) {
      // The neighbour's failure is declared in `errors:` of the operation
      // and reaches the client unchanged
      return claimed;
    }

    // `Ok.created` sets the success status on the value; HTTP maps it to 201
    return Ok.created({ id: '2', name: payload.name, email: payload.email });
  }
}

export const CreateUser = httpEndpoint.implement(CreateUserOperation, {
  pipeline: authed,
  handler: CreateUserHandler,
});
```

`Output<Value, Failures>` is the return type of a handler: the second
argument lists every failure it may return, and the compiler checks that
list against the `errors:` of the endpoint or of its operation. A failure
that is not declared there is replaced by `internal_error` at run time, so
the compiler error is the friendly version of the same rule.

On success the handler returns the value itself. `Ok.created(value)`,
`Ok.accepted(value)` and `Ok.noContent()` set a different success status
without mentioning HTTP; the transport maps it.

## Reading one

A port call, a stub and a client all return `Ok | Fail`:

<!-- snippet: read-failure.ts#reading -->
```typescript
const claimed = await this.quotas.call(input);

if (claimed.isFail) {
  return claimed; // pass it on, if it is declared in errors:
}

return claimed.value; // typed by the output schema of the operation
```

`QuotaExceeded.is(claimed)` tells one declared failure from another.
`instanceof` is not used: a failure that crossed a process boundary is
rebuilt from its code, and the class it once had is gone.

## On the wire over HTTP

The HTTP boundary answers a failure with a Problem Details document,
RFC 9457, under the media type `application/problem+json`:

```json
{
  "type": "urn:error:not_found:user",
  "title": "Not Found",
  "status": 404,
  "detail": "User 9 not found",
  "details": { "id": "9" }
}
```

| Member | What it carries |
|---|---|
| `type` | the code of the failure behind the prefix `urn:error:` |
| `title` | the phrase of the HTTP status |
| `status` | the HTTP status as a number |
| `detail` | the message of the failure |
| `details` | the details by the schema of the definition |
| `stack` | an extension, only under `exposeErrorDetails` |

**There is no `code` member**: the code lives inside `type`. A test written
against a body of `{ error, code, details }` fails — that shape is gone.
One document serves all three places the boundary writes a failure: the
answer of a handler, an error before the pipeline (a broken JSON body, an
exceeded `maxBodySize`) and an `event: error` frame in SSE. The NATS, CLI
and MCP transports serialise a failure their own way.

`@nestlingjs/client` rebuilds the failure from the document, so the calling
code branches on `UserNotFound.is(result)` and never parses a body.

## Failures nobody declares

Failures of the kernel — `bad_request` from input validation, `timeout`
from an exhausted call budget, `internal_error` from a thrown error —
belong to `Output` without being declared. Do not list them in `errors:`
and do not try to produce them by hand.

Failures of a layer are declared once, next to the step:
`makePipeline().pre(Authenticate, { errors: [Unauthorized] })`. Every
endpoint that takes the layer answers with them, and none of them repeats
the failure in its own `errors:`.
