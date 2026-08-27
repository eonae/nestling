# @nestling/client

A typed HTTP client built from contract **values**: `makeClient(record,
config)` returns an API object whose call-site is the same as the contract's
invoker — `Ok | Fail` for `request`, `Promise<void>` for `command`.

> 🚧 Active development, API may change. Design:
> [`docs/design/contracts.md`](../../docs/design/contracts.md) §5.
> Guide: [`docs/guides/typed-client.md`](../../docs/guides/typed-client.md).

```typescript
import { CreateUser, GetUser } from '@acme/billing-contracts';
import { makeClient } from '@nestling/client';

const api = makeClient(
  { createUser: CreateUser, getUser: GetUser },     // the consumer names the methods
  { baseUrl, headers: () => ({ authorization: `Bearer ${token()}` }) },
);

const created = await api.createUser({ name: 'Alice', email: 'a@b.c' });

if (EmailTaken.is(created)) {
  // `details` are typed by the definition's schema; identity is the code,
  // not `instanceof` — the class is dead once the value crossed the wire
} else if (created.isFail) {
  // the set is closed: E ∪ UnknownError, exactly as with `.port`
} else {
  created.value.id;
}
```

## What it does

- **Builds the request from the contract's bind map** — the inverse of the
  transport's strict intake. Path parameters are substituted with
  `encodeURIComponent`; the rest goes to query or body per the map's rule.
  The round-trip invariant (parse what the client built and get the original
  payload back) is covered by a test, not inferred from the two
  implementations looking alike.
- **Validates the response** against the contract's `output` form through
  `~standard.validate` — by default, with an explicit
  `validateOutput: false` opt-out.
- **Rematerializes declared failures** by `code` from `errors:`: the status
  comes from the definition, the message from the wire, the details from the
  wire but checked against the definition's schema. Everything else —
  network, non-JSON body, undeclared code, mismatched details — is
  `UnknownError` with the original in `cause`.
- **Never throws on transport or contract failures** for a `request`
  contract. It throws only on defects of use (a query value with no wire
  representation).

## What it refuses, at creation time

A contract with no `http:` section, an `event` contract, a streaming
(`stream`/`events`) or `multipart` io form, a non-JSON body (`'binary'`/
`'text'`), a non-absolute `baseUrl`. Every message names the method key in
the record; there is no deferred "it will fail on first call" diagnostic.

## Dependencies

Only [`@nestling/contracts`](../nestling.contracts), and `fetch` — no
Node-specific API. The import closure is checked by the same boundary test
that guards the contracts package, so "builds for the browser" is an
invariant rather than a line in this README.

The `fetch` implementation is an injectable option: the client is testable
without the network, and works in runtimes that bring their own.
