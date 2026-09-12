# @nestlingjs/openapi

An OpenAPI 3.1 document assembled from the same endpoint declarations
that serve the requests. A second description of the API next to the
code is not needed.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/schemas.md`](../../docs/en/design/schemas.md) §2.1.
> Guide: [chapter 13. Give the frontend the documentation and the client](../../docs/en/guide/13-openapi-and-client.md).

## Install

```bash
npm install @nestlingjs/openapi @nestlingjs/schema.zod
```

`@nestlingjs/schema.zod` is needed if the schemas are written in zod.
For another validator, its converter is connected.

## Minimal example

```typescript
import { openapi } from '@nestlingjs/openapi';
import { zodConverter } from '@nestlingjs/schema.zod';

makeApp({
  features: [UsersFeature],
  plugins: [
    openapi({
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
      pipeline: observability, // if the root policy requires the layer
    }),
  ],
  transports: [http()],
});
// GET /openapi.json
```

## Exports

| Name | What it does |
|---|---|
| `openapi` | a plugin: builds the document on the ASSEMBLE phase and serves it as an endpoint |
| `buildOpenApiDocument` | a pure function: the document from `app.discover(args).endpoints` |
| `OpenApiDocument$` | the DI token of the ready document |
| `hiddenEndpoints` | the endpoints hidden by the `doc.hidden` field |
| `OpenApiOptions` | `info`, `converters`, `servers`, `security`, `externalDocs` |
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

## Package boundaries

The package does not ship Swagger UI, does not derive `servers` from
the configuration, and does not generate AsyncAPI.
