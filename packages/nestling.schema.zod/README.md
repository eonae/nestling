# @nestlingjs/schema.zod

Everything Nestling does with zod: the converter of schemas into JSON
Schema, the builders for configuration section fields, and the models the
compiler checks against an already existing TypeScript type. The schemas
the framework writes itself are written in zod, and this package is their
only home.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/schemas.md`](../../docs/en/design/schemas.md) §1–§2.
> Guide: [chapter 13. Give the frontend the documentation and the client](../../docs/en/guide/13-openapi-and-client.md).

## Install

```bash
npm install @nestlingjs/schema.zod zod
```

`zod` is a peer dependency: the converter translates the schemas of the
application and has to work with the same copy of the validator it does.

Installing the package by hand is not always needed. The consumers of
JSON Schema — `@nestlingjs/openapi`, `@nestlingjs/mcp` and
`@nestlingjs/transport.cli` — depend on it themselves and take
`zodConverter()` by default. A line of `npm install` of your own is
needed by those who want the builders, the models, or their own converter
with different options.

## Minimal example

```typescript
import { makeConfig } from '@nestlingjs/app';
import { flag, int } from '@nestlingjs/schema.zod';

export const RelayConfig = makeConfig('relay', {
  batchSize: int().min(1).default(100),
  enabled: flag().default(true),
});
```

## Exports

| Name | What it does |
|---|---|
| `zodConverter` | returns a `SchemaDocConverter` with `vendor: 'zod'` on top of `z.toJSONSchema()` |
| `ZodConverterOptions` | the options of `z.toJSONSchema` without `io` |
| `withZodDefault` | resolves the consumer's converter list: appends `zodConverter()`, or yields to a zod converter already in the list |
| `int` | an integer with string coercion; the caller appends the bound and the default |
| `flag` | a boolean value that also accepts its string spelling (`'true'`, `'1'`, `'on'`) |
| `fromType` | `fromType<T>().makeModel(schema)` — a type-level check of the schema input against a domain type |
| `fromScratch` | the same for the case when there is no domain type yet |
| `makeModel` | `fromScratch().makeModel(schema)` in one call |

`int()` and `flag()` return an **open** zod value: the caller appends the
bounds, the description and the default with a chain. They take no
positional arguments — an argument would close off the rest of the
validator's constraints. There are no stand-ins for what zod already gives
in one expression either: a required non-empty string is
`z.string().min(1)`, an enumeration is `z.enum([…])`, a record of fields is
`z.object({ … })`.

A schema with a transform (`z.string().transform(Number)`,
`z.stringbool()`) describes two forms: the one that arrives in the
request, and the one the handler receives. The caller chooses which one to
describe: the OpenAPI generator passes `io: 'input'` for the request body
and `io: 'output'` for the response body. The CLI transport takes the
`io: 'input'` form: the input of a command arrives as strings from argv.

## Package boundaries

The package converts only zod schemas. Another validator needs its own
converter — it is passed in the `converters` list and stands next to the
default rather than displacing it. The empty-key rule is not part of the
package either: `KEY=` is reduced to `undefined` by the kernel, before the
field schema is called ([config.md §1](../../docs/en/design/config.md)).
