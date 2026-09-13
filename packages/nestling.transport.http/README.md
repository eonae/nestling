# @nestlingjs/transport.http

The Nestling HTTP transport on `node:http`: routing through
`find-my-way`, request body parsing by the endpoint's io declaration
(JSON, raw bytes, NDJSON, multipart through `busboy`), and response
format selection from the same declaration — NDJSON for `stream(T)`,
SSE for `events(T)`. The same set of endpoints runs inside a foreign
process: `adapter()` declares a transport without a socket and hands the
request handler out.

> 🚧 Active development, the API may change. CORS, rate limiting and
> compression are not implemented. The package does not choose a
> validator for the application's schemas: `@nestlingjs/app` validates
> the data.
> Design: [`docs/en/design/transports.md`](../../docs/en/design/transports.md).
> Guide: [chapter 1. Bring up a service that answers a request](../../docs/en/guide/01-first-service.md),
> [chapter 12. Files and streams](../../docs/en/guide/12-files-and-streams.md).
> Recipe: [an application inside a foreign process](../../docs/en/recipes/embedded.md).

## Install

```bash
npm install @nestlingjs/transport.http
```

The `zod` package in the dependencies is needed only for the server's
configuration section (`HTTP_PORT`, `HTTP_HOST`).

## Minimal example

```typescript
import { makeApp, Ok } from '@nestlingjs/app';
import {
  adapter,
  http,
  httpEndpoint,
  toFetchHandler,
} from '@nestlingjs/transport.http';
import { z } from 'zod';

export const GetUser = httpEndpoint.get('/users/:id', {
  input: z.object({ id: z.string() }), // id comes from the path
  output: z.object({ id: z.string(), name: z.string() }),
  handler: async ({ id }) => new Ok({ id, name: 'Alice' }),
});

// Own process: the transport runs on a server, the server holds the socket
await makeApp({
  features: [UsersFeature], // the feature where GetUser is declared
  transports: [http()], // a declaration, not an instance
})
  .build()
  .run();

// Foreign process: there is no socket, the request handler goes out
const embedded = makeApp({
  features: [UsersFeature],
  transports: [adapter()],
}).build();

await embedded.run({ signals: false }); // signals stay with the process owner

export const GET = toFetchHandler(embedded); // (Request) => Promise<Response>
```

## Exports

- **Transport** ([design](../../docs/en/design/transports.md)) — `http`,
  `HTTP_CAPABILITIES`, `HTTP_TRANSPORT_NAME`, `HttpTransport`,
  `HttpTransport$`.
- **Adapter** ([recipe](../../docs/en/recipes/embedded.md)) — `adapter`,
  `HttpAdapter`, `HttpFetchHandler`, `HttpNodeHandler`, `toFetchHandler`,
  `toNodeHandler`.
- **Server and probes** — `httpProbes`, `HttpServer`, `HttpServer$`,
  `server`, `serverKeys`.
- **Endpoint declaration** ([design](../../docs/en/design/endpoints.md))
  — `httpBindingOf`, `httpEndpoint`, `httpEndpoint.implement`,
  `HttpRouter`, `HttpStartContext`.

  `httpEndpoint` is a value, not a function. Seven statics create the
  declaration. Six of them are named by the HTTP method — `get`, `head`,
  `post`, `put`, `patch`, `delete` — and declare the address themselves:
  the method is named by the constructor, the path is the first
  argument. The seventh, `httpEndpoint.implement(Operation, { … })`,
  implements an operation with an `http:` section: the address, the
  schemas, `errors` and `doc` come from it.
- **Request and response** — `Cookie`, `httpCodeOf`, `HttpHandler`,
  `HttpHandlerMeta`, `HttpOutput`, `HttpOutputSync`, `HttpRequest`,
  `HttpResponse`.
- **Re-export of [`@nestlingjs/operations`](../nestling.operations/)** — the
  failure body format ([design](../../docs/en/design/errors.md)).

  A failure travels as an RFC 9457 document under the
  `application/problem+json` media type: the failure code sits in the
  `type` member with the `urn:error:` prefix, the message in `detail`,
  the details in `details`. The media type, the type prefix, building the
  document and parsing the type back into a code are declared in the
  operations package, so that the client reads the document in a browser;
  they are re-exported from here so that the documentation generator and a
  transport on top of a foreign server take the format from the same place
  as `httpCodeOf`.
- **Byte level** — `buildPayload`, `bindingNeedsBody`, `HttpSink`,
  `HttpSource`, `parseJson`, `parseMultipartForm`, `parseNdjson`,
  `parseRaw`, `PayloadTooLargeError`, `readQuery`, `sendResponse`.

  These parts are public on purpose: a custom `ITransport`
  implementation can be built on top of a third-party HTTP server
  from them, without changing the package. `HttpSource` and `HttpSink`
  describe what the transport reads from the request and what it writes
  the response into; `IncomingMessage` and `ServerResponse` satisfy them
  as they are.
- **Pipeline steps** ([design](../../docs/en/design/pipeline.md)) —
  `httpAccessLog`, `withClientIp`, `withHeader`.

## Package boundaries

The transport parses the request and sends the response.
`@nestlingjs/app` validates the data against the schema and runs the
policies and the pipeline. The byte level (compression, CORS, rate
limiting) stays with the reverse proxy.
