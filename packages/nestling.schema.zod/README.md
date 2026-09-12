# @nestlingjs/schema.zod

A converter of zod schemas into JSON Schema: a wrapper around the
built-in `z.toJSONSchema()`. JSON Schema is read by the OpenAPI
generator, the structural check of contracts and the questions of the
CLI transport. The converter is named explicitly even in an
application written entirely in zod: consumers have no «vendor —
converter» registry.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/schemas.md`](../../docs/en/design/schemas.md) §2.
> Guide: [chapter 13. Give the frontend the documentation and the client](../../docs/en/guide/13-openapi-and-client.md).

## Install

```bash
npm install @nestlingjs/schema.zod zod
```

`zod` is a peer dependency: the version used by the application is
installed.

## Minimal example

```typescript
import { openapi } from '@nestlingjs/openapi';
import { zodConverter } from '@nestlingjs/schema.zod';

openapi({
  info: { title: 'users', version: '1.0.0' },
  converters: [zodConverter({ unrepresentable: 'any' })],
});
```

The CLI transport accepts the same converter: for commands with the
`missing: 'prompt'` policy it gives the field forms for the questions
in the terminal — `cli({ converters: [zodConverter()] })`.

## Exports

| Name | What it does |
|---|---|
| `zodConverter` | returns a `SchemaDocConverter` with `vendor: 'zod'` |
| `ZodConverterOptions` | the options of `z.toJSONSchema` without `io` |

A schema with a transform (`z.string().transform(Number)`,
`z.stringbool()`) describes two forms: the one that arrives in the
request, and the one the handler receives. The caller chooses which one
to describe: the OpenAPI generator passes `io: 'input'` for the request
body and `io: 'output'` for the response body. It takes the schema of a
path or query parameter from the `io: 'output'` form when that one is
scalar, and the `io: 'input'` form is a string. The CLI transport takes
the `io: 'input'` form: the input of a command arrives as strings from
argv.

## Package boundaries

The package converts only zod schemas. Another validator needs its own
converter.
