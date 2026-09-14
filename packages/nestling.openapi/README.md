# @nestlingjs/openapi

An OpenAPI 3.1 document built from the same endpoint declarations
that serve the requests. A second description of the API next to the
code is not needed.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/schemas.md`](../../docs/en/design/schemas.md) §2.1.
> Guide: [chapter 13. Give the frontend the documentation and the client](../../docs/en/guide/13-openapi-and-client.md).

## Install

```bash
npm install @nestlingjs/openapi
```

The converter for the vendor the framework writes its own schemas in
comes as a dependency of the package. An application on another
validator needs that validator's converter — it is passed in the
`converters` list.

## Minimal example

```typescript
import { makeOpenapi } from '@nestlingjs/openapi';

export const openapi = makeOpenapi({
  info: { title: 'Users API', version: '1.0.0' },
  pipeline: observability, // if the root policy requires the layer
});

makeApp({
  features: [UsersFeature],
  plugins: [openapi],
  transports: [http()],
});
// GET /openapi.json

// The same document for the build artifacts, without starting the app:
openapi.document(app.discover(args));
```

## Exports

| Name | What it does |
|---|---|
| `makeOpenapi` | a plugin: builds the document on the BUILD phase, serves it as an endpoint, and gives it as a value through the `document(discovery)` method |
| `OpenApiDocument$` | the DI token of the ready document |
| `OpenApiPlugin` | the plugin value: an ordinary step of the composition plus the `document` method |
| `OpenApiOptions` | `info`, the optional `converters`, `servers`, `security`, `externalDocs` |
| `OpenApiServeOptions` | the plugin options: `path`, `pipeline`, `detached`, `announceHidden` |
| `OpenApiDocument` | the whole document |
| `OpenApiInfo` | the `info` section |
| `OpenApiPathItem` | one path of the document |
| `OpenApiOperation` | one operation of a path |
| `OpenApiParameter` | a path or query parameter |
| `OpenApiRequestBody` | the request body |
| `OpenApiResponse` | one response of an operation |
| `OpenApiContent` | the «media type — schema» map |
| `DocumentedEndpoint` | the generator's input: an endpoint declaration with a `doc:` section |
| `JsonValue` | a JSON value in the document |
| Re-export of [`@nestlingjs/app`](../nestling.app/) | `SchemaDocConverter` — the schema converter interface |

Failure responses are described by what the transport actually writes: an
RFC 9457 document under the `application/problem+json` media type
([design](../../docs/en/design/errors.md)). The `type` member is described
by the constant `urn:error:<failure code>`, `title` and `status` by
constants derived from the category; two failures on one response code
fold into `oneOf` and stay distinguishable by `type`. The generator takes
the media type and the way `type` is built from the exports of
`@nestlingjs/transport.http`, so the document and the response never
drift apart.

## Package boundaries

The package does not ship Swagger UI, does not derive `servers` from
the configuration, and does not generate AsyncAPI. Its public types do
not name a validator: the schema comes from the application, and the
translation into JSON Schema comes from a converter.
