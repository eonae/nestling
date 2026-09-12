# @nestlingjs/models

Input and output data models on zod: a schema with validation and type
inference that the compiler checks against an already existing
TypeScript type. This is needed where the type is set in advance (for
example, generated from proto, GraphQL or OpenAPI), and the schema must
describe it.

> 🛰️ A zod satellite, outside the V1 core: the package has
> `peerDependencies.zod`, the API may change.
> Design: [`docs/en/design/schemas.md`](../../docs/en/design/schemas.md).
> Guide: [chapter 3. Check the input](../../docs/en/guide/03-input.md).

## Install

```bash
npm install @nestlingjs/models zod
```

The package requires `zod@^4.0.0` as a peer dependency.

## Minimal example

```typescript
import { fromType } from '@nestlingjs/models';
import { z } from 'zod';

// the type already exists: for example, generated from proto
interface UserProto {
  name?: string;
  email?: string;
  age?: number;
}

const UserModel = fromType<UserProto>().makeModel(
  z.object({
    name: z.string().min(1).max(100),
    email: z.email(),
    age: z.number().min(0).max(150),
  }),
);

// the result type is stricter than the source: all fields became required.
// an extra field in the schema or an incompatible type is a compilation error.
const user = UserModel.parse({ name: 'Alice', email: 'a@b.c', age: 30 });
```

## Exports

| Name | What it does |
|---|---|
| `fromType` | `fromType<T>().makeModel(schema)`: checks at compile time that `z.input<S>` narrows `T` |
| `fromScratch` | `fromScratch().makeModel(schema)`: returns the schema without checking it against a type |
| `makeModel` | the same as `fromScratch().makeModel(schema)` |

None of the three functions do anything at runtime: they return the
schema they were given. All the work happens in the types.

## Package boundaries

The package does not validate data itself, does not register in the
container and does not connect to transports. It gives out a zod schema
that is passed into the `input`/`output` of an endpoint or called
directly.
