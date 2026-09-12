# Features and operations

A feature is a unit of deployment: providers, modules and endpoints under a
name. Only features move into separate processes, and they talk to each
other only through operations. Names live in the READMEs of
[`@nestlingjs/app`](https://www.npmjs.com/package/@nestlingjs/app) and
[`@nestlingjs/operations`](https://www.npmjs.com/package/@nestlingjs/operations).

<!-- snippet: users.feature.ts -->
```typescript
import {
  ClaimQuotaImpl,
  QuotaService,
  UserRegisteredInQuotas,
} from './claim-quota.endpoint.js';
import { CreateUser } from './create-user.endpoint.js';
import { GetUser } from './get-user.endpoint.js';
import { ListUsers } from './list-users.endpoint.js';
import { UsersModule } from './users.module.js';

import { makeFeature } from '@nestlingjs/app';

export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  endpoints: [GetUser, ListUsers, CreateUser],
});

export const QuotasFeature = makeFeature({
  name: 'quotas',
  providers: [QuotaService],
  endpoints: [ClaimQuotaImpl, UserRegisteredInQuotas],
});
```

A feature lists its own `providers:`, `modules:` when there are enough
providers to group, and `endpoints:` always. It never lists the features it
needs: that link is derived from the operations its handlers call.

## Operations

An operation is the contract between two features. It belongs to neither,
so it lives outside both — in `src/operations.ts`.

<!-- snippet: intercom-operations.ts -->
```typescript
import {
  makeCommand,
  makeEvent,
  makeFail,
  makeRequest,
} from '@nestlingjs/operations';
import { z } from 'zod';

export const QuotaExceeded = makeFail('too_many_requests:quota_exceeded', {
  details: z.object({ limit: z.number() }),
  message: (d) => `User quota of ${d.limit} is exhausted`,
});

/** `request`: one owner, and the caller cannot go on without the answer */
export const ClaimQuota = makeRequest({
  name: 'quotas.claim',
  input: z.object({ email: z.string() }),
  output: z.object({ remaining: z.number() }),
  errors: [QuotaExceeded],
});

/** `event`: the fact already happened, any number of subscribers, no answer */
export const UserRegistered = makeEvent({
  name: 'users.registered',
  input: z.object({ id: z.string(), email: z.string() }),
});

/** `command`: one owner, and `meta.idempotencyKey` tells a retry apart */
export const SignupRecorded = makeCommand({
  name: 'quotas.record-signup',
  input: z.object({ userId: z.string() }),
});
```

| Kind | Owners | Answer | Use when |
|---|---|---|---|
| `makeRequest` | exactly one | `Ok \| Fail` | the caller cannot continue without it |
| `makeCommand` | exactly one | none | a side effect that must happen once; `meta.idempotencyKey` marks a retry |
| `makeEvent` | any number | none | the fact already happened |

## Implementing and calling

The owner implements an operation. The endpoint it produces is the same
kind of value as an HTTP one and takes part in policies and tests.

<!-- snippet: claim-quota.endpoint.ts -->
```typescript
import {
  ClaimQuota,
  QuotaExceeded,
  UserRegistered,
} from './intercom-operations.js';

import type { Logger } from '@nestlingjs/app';
import { implement, Logger$ } from '@nestlingjs/app';
import { Component, Handler } from '@nestlingjs/container';

@Component([])
export class QuotaService {
  readonly limit = 5;

  #used = 0;

  claim(): boolean {
    return this.#used++ < this.limit;
  }
}

@Handler([QuotaService])
class ClaimQuotaHandler {
  constructor(private readonly quotas: QuotaService) {}

  async handle(_payload: { email: string }) {
    return this.quotas.claim()
      ? { remaining: this.quotas.limit }
      : QuotaExceeded({ limit: this.quotas.limit });
  }
}

/** `input`, `output` and `errors` belong to the operation */
export const ClaimQuotaImpl = implement(ClaimQuota, {
  handler: ClaimQuotaHandler,
});

@Handler([Logger$.auto])
class UserRegisteredInQuotasHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: { id: string; email: string }) {
    this.logger.info('quota bookkeeping', { userId: payload.id });
  }
}

export const UserRegisteredInQuotas = implement(UserRegistered, {
  subscriber: 'quotas',
  handler: UserRegisteredInQuotasHandler,
});
```

`subscriber:` is required for an event: it names the subscription inside
the process and becomes the queue group name at the broker. The caller
injects `Operation.caller` for a request and `Operation.emitter` for an
event or a command.

<!-- snippet: call-neighbour.ts -->
```typescript
import { ClaimQuota, UserRegistered } from './intercom-operations.js';

import type { Emitter, Port } from '@nestlingjs/app';
import { deadlineIn } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

@Handler([ClaimQuota.caller, UserRegistered.emitter])
export class SignUp {
  constructor(
    private readonly quotas: Port<typeof ClaimQuota>,
    private readonly registered: Emitter<typeof UserRegistered>,
  ) {}

  async handle(payload: { email: string }) {
    // A deadline is a moment, not a duration: it does not stretch on `await`
    const claimed = await this.quotas.call(payload, {
      deadline: deadlineIn(500),
    });

    if (claimed.isFail) {
      return claimed;
    }

    await this.registered.emit({ id: '2', email: payload.email });

    return { id: '2', email: payload.email };
  }
}
```

A call has no default timeout: pass `deadline` when the caller has a budget
for the answer. `emit` resolves on delivery, and subscriber failures do not
travel back.

## Choosing what to run

- `app.assemble('users')` starts only that feature, and
  `{ features: 'users', includeDeps: true }` adds the features whose
  operations it calls. The selection comes from the root config, so one
  image serves every role.
- `makeSwitch('docs', { default: 'on' })` declares a switch: `Docs.when(x)`
  keeps a plugin in one branch only, `Switch.pick({ … })` chooses between
  values. Both branches stay visible to the compiler.
- Splitting across processes changes one field: `intercom: 'events'` next
  to `transports: [nats({ name: 'events' })]`. A call to an operation whose
  owner is not in this assembly then goes over the bus, and the calling
  code does not change.
