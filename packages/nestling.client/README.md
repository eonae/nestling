# @nestlingjs/client

A typed HTTP client built from operation declarations.
`makeClient(record, config)` returns an API object whose method is called
the same way as an operation's port: `Ok | Fail` for `request`,
`Promise<void>` for `command`. The package depends only on
`@nestlingjs/operations` and the global `fetch`, so it builds for the
browser.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/operations.md`](../../docs/en/design/operations.md) §5.
> Guide: [chapter 13. Give the frontend the documentation and the client](../../docs/en/guide/13-openapi-and-client.md).

## Install

```bash
npm install @nestlingjs/client
```

## Minimal example

```typescript
import { CreateUser, GetUser } from '@acme/billing-operations';
import { makeClient } from '@nestlingjs/client';

const api = makeClient(
  { createUser: CreateUser, getUser: GetUser }, // you choose the method names
  { baseUrl, headers: () => ({ authorization: `Bearer ${token()}` }) },
);

const created = await api.createUser({ name: 'Alice', email: 'a@b.c' });

if (EmailTaken.is(created)) {
  // details are typed by the schema from makeFail; the failure is recognized by code
} else if (created.isFail) {
  // the set of responses is closed: the declared failures plus InternalError
} else {
  created.value.id;
}
```

## Exports

| Name | What it does |
|---|---|
| `makeClient` | builds the API object from a record of operations and configuration |
| `Client` | the type of the assembled API object |
| `ClientConfig` | `baseUrl`, `headers`, a trace reader `trace`, a custom `fetch` implementation, `validateOutput` |
| `ClientMeta` | the second argument of the method: `signal` and `deadline` |
| `ClientMethod` | the type of one client method |
| `ClientArgs` | the method arguments, derived from the operation |
| `ClientResult` | the method result, derived from the operation |
| `ClientFail` | the client failure: the one declared by the operation, or `InternalError` |
| `ClientHeaders` | headers: an object, or a function called on every request |

`makeClient` throws a `TypeError` immediately, naming the method key: an
operation without an `http:` section, an operation of the `event` kind,
a streaming or `multipart` io shape, a non-JSON body, a non-absolute
`baseUrl`.

The client reads a failure from an RFC 9457 document
([design](../../docs/en/design/errors.md)): the failure code comes from
the `type` member with the `urn:error:` prefix dropped, the message from
`detail`, the details from `details` checked against the schema of the
definition. A type without that prefix, a missing type and a code not
declared in the operation's `errors:` all give `InternalError` with the
response body in `cause`.

The `trace` option sets the `traceparent` header — a function that
returns a W3C trace-context string or `undefined`. A ready reader is
exported by `@nestlingjs/app` under the name `traceparent`; the client
does not obtain it itself, because the ambient context of a request is
not available in a browser. A header set by the `headers` field takes
precedence.

## Package boundaries

The client does not support streaming and multipart operations, events
and `idempotencyKey`.
