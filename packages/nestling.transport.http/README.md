# @nestling/transport.http

HTTP transport for Nestling built on bare `node:http`: routing via
`find-my-way`, body parsing driven by the endpoint's io declaration
(JSON, raw, NDJSON streams, multipart via `busboy`), NDJSON streaming
responses.

> 🚧 Active development. Works, but **not production-hardened yet**
> (no body-size limits, timeouts, or CORS). Architecture:
> [`docs/design/transports.md`](../../docs/design/transports.md).

Usage guides: [functional HTTP](../../docs/guides/http-functional.md),
[App with DI](../../docs/guides/http-app-di.md).
