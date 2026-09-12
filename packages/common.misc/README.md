# @nestlingjs/common.misc

The schema kernel of Nestling and shared helper types. The package sets
the vocabulary of schemas over [Standard Schema v1](https://standardschema.dev)
and holds the single place where the kernel validates data by a schema —
`validateSync`. Input parsing by the pipeline, item-by-item stream
checking and configuration section fields all pass through it, so a
validation error looks the same everywhere.

> Internal Nestling package: installed together with the kernel, part of its names are re-exported by `@nestlingjs/app`.

## Install

The package is internal and arrives as a dependency of the kernel. There
is no need to install it separately: the listed names are available from
`@nestlingjs/app`.

## Minimal example

```typescript
import { SchemaValidationError, validateSync } from '@nestlingjs/common.misc';
import { z } from 'zod';

const schema = z.object({ id: z.string() });

try {
  const value = validateSync(schema, { id: 42 }, 'bad payload');
  console.log(value.id);
} catch (error) {
  // issues are already normalized: the path is unfolded, symbols are
  // cast to strings.
  if (error instanceof SchemaValidationError) console.log(error.issues);
}
```

## Exports

| Name | What it does |
|---|---|
| `Schema` | an alias of `StandardSchemaV1`: any validator of the spec fits |
| `Infer` | the output type of a schema, or `undefined` when there is no schema |
| `DomainType` | the output type of a schema that is always set |
| `SchemaIssue` | one validator complaint after normalization |
| `validateSync` | validates a value by a schema and returns the parsed result |
| `assertStandardSchema` | checks that a value implements the spec |
| `normalizeIssues` | normalizes `issues` of own code the same way as the kernel |
| `SchemaValidationError` | a value did not pass the schema; carries `issues` |
| `AsyncSchemaNotSupportedError` | the schema returned a promise: asynchronous validation is not supported |
| `NotAStandardSchemaError` | the object has no `~standard` with `version: 1` |
| `Constructor` | a class constructor as a value |
| `Optional` | `T` or `undefined` |
| Re-export of `@standard-schema/spec` | `StandardSchemaV1`, so the spec package does not need to be installed |

## Package boundaries

The kernel does not look inside a schema: the spec gives only validation
and type inference. Parsing a schema into JSON Schema is done by the
`@nestlingjs/openapi` converters.
