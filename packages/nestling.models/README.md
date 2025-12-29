# @nestling/models

> 📖 **[Русская версия](./README.ru.md)**

**Type-safe input/output models for Nestling applications**

A library for defining data models with validation, automatic type inference, documentation, and transformations. Built on top of [Zod v4](https://github.com/colinhacks/zod).

## Why this library?

When developing applications, we constantly work with input and output data. This data must:

- ✅ **Be strictly typed** — so TypeScript helps catch errors at compile time
- ✅ **Pass validation** — to protect the application from incorrect data
- ✅ **Be documented** — to generate OpenAPI specifications
- ✅ **Be transformed** — to convert strings to numbers, dates, class instances, etc.

**Zod** handles these tasks excellently, but a problem arises when **types already exist** (e.g., generated from proto contracts, GraphQL schemas, or OpenAPI).

`@nestling/models` solves this problem by providing two approaches:

### 1. Creating models "from scratch" (`fromScratch`)

When types don't exist yet and should be inferred from the schema:

```typescript
import { fromScratch } from '@nestling/models';
import { z } from 'zod';

const UserModel = fromScratch().defineModel(
  z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    age: z.number().min(0).max(150),
  })
);

// TypeScript automatically infers the type:
// type User = { name: string; email: string; age: number }

const user = UserModel.parse({ name: 'Alice', email: 'alice@example.com', age: 30 });
```

### 2. Working with existing types (`fromType`)

When you already have TypeScript types (e.g., from proto) and you need to:
- Guarantee that the schema fully covers the type
- Add validation and transformations
- Have the ability to "narrow" types (make optional fields required)

```typescript
import { fromType } from '@nestling/models';
import { z } from 'zod';

// Type already exists (e.g., generated from proto)
interface UserProto {
  name?: string;
  email?: string;
  age?: number;
}

const UserModel = fromType<UserProto>().defineModel(
  z.object({
    name: z.string().min(1).max(100),    // optional → required
    email: z.string().email(),            // optional → required
    age: z.number().min(0).max(150),      // optional → required
  })
);

// Resulting type is stricter than the original:
// type User = { name: string; email: string; age: number }
// all fields became required!

const user = UserModel.parse({ name: 'Alice', email: 'alice@example.com', age: 30 });
```

## Installation

```bash
yarn add @nestling/models zod
# or
npm install @nestling/models zod
```

**Important:** The library requires `zod@^4.0.0` as a peer dependency.

## Quick Start

### Two ways to use the library

#### 1️⃣ `fromScratch()` — types are inferred from schema

```typescript
import { fromScratch } from '@nestling/models';
import { z } from 'zod';

const UserModel = fromScratch().defineModel(
  z.object({
    name: z.string(),
    email: z.string().email(),
    age: z.number().min(18),
  })
);

// Type automatically inferred: { name: string; email: string; age: number }
```

#### 2️⃣ `fromType<T>()` — working with existing types

```typescript
import { fromType } from '@nestling/models';
import { z } from 'zod';

interface UserProto {
  name?: string;
  email?: string;
  age?: number;
}

const UserModel = fromType<UserProto>().defineModel(
  z.object({
    name: z.string(),      // ✅ optional → required (narrowing)
    email: z.string().email(),
    age: z.number().min(18),
  })
);

// Result: { name: string; email: string; age: number }
// TypeScript guarantees that schema matches the type
```

### Key features

#### ✅ Validation

```typescript
try {
  const user = UserModel.parse(data);
} catch (error) {
  console.error(error.issues);
}
```

#### ✅ Transformations

```typescript
const Model = fromScratch().defineModel(
  z.object({
    id: z.string().transform(val => parseInt(val, 10)),
    createdAt: z.string().transform(val => new Date(val)),
  })
);
```

#### ✅ Type Narrowing

```typescript
// ✅ Allowed
optional → required
string → 'admin' | 'user'
number → number (min: 0, max: 100)

// ❌ Prohibited
Adding fields that don't exist in the type
required → optional
Incompatible types (string → number)
```

#### ✅ Nested objects

```typescript
const Model = fromType<UserProto>().defineModel(
  z.object({
    profile: z.object({
      firstName: z.string(),   // Narrowing works recursively
      address: z.object({
        city: z.string(),      // Nested fields can also become required
      }),
    }),
  })
);
```

#### ✅ Transport integration

```typescript
app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/users',
  handler: async (ctx) => {
    const user = UserModel.parse(ctx.payload);  // Validation + type
    return { status: 201, value: { user } };
  }
});
```

## API

### `fromScratch()`

Creates a model without binding to an existing type. TypeScript automatically infers the type from the schema.

```typescript
const CalcModel = fromScratch().defineModel(
  z.object({
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
    operation: z.enum(['add', 'sub', 'mul', 'div']).describe('Operation'),
  })
);

// Type inference:
// { a: number; b: number; operation: 'add' | 'sub' | 'mul' | 'div' }
```

### `fromType<T>()`

Creates a model based on an existing type with **type narrowing** support.

#### What is Type Narrowing?

Narrowing allows:
- ✅ Making optional fields required (`string?` → `string`)
- ✅ Narrowing types (`string` → `'admin' | 'user'`)
- ✅ Adding constraints (`number` → `number (min: 0, max: 100)`)
- ❌ BUT prohibits adding new fields that don't exist in the original type

```typescript
interface CreateUserProto {
  name?: string;
  email?: string;
  role?: string;
  age?: number;
}

const CreateUserModel = fromType<CreateUserProto>().defineModel(
  z.object({
    name: z.string().min(1),              // ✅ optional → required
    email: z.string().email(),            // ✅ optional → required
    role: z.enum(['admin', 'user']),      // ✅ string → enum (narrowing)
    age: z.number().min(18).max(100),     // ✅ adding constraints
  })
);

// Result: { name: string; email: string; role: 'admin' | 'user'; age: number }
```

#### What is prohibited with Narrowing?

```typescript
interface UserProto {
  name?: string;
}

// ❌ ERROR: cannot add fields that don't exist in the type
const BadModel = fromType<UserProto>().defineModel(
  z.object({
    name: z.string(),
    age: z.number(),  // ← Field 'age' doesn't exist in UserProto!
  })
);

// ❌ ERROR: cannot change type incompatibly
const BadModel2 = fromType<UserProto>().defineModel(
  z.object({
    name: z.number(),  // ← name should be string, not number
  })
);

// ❌ ERROR: cannot make required fields optional
interface UserWithRequired {
  name: string;  // required field
}

const BadModel3 = fromType<UserWithRequired>().defineModel(
  z.object({
    name: z.string().optional(),  // ← cannot make optional
  })
);
```

#### Working with nested objects

Narrowing works recursively for nested objects:

```typescript
interface UserProto {
  profile?: {
    firstName?: string;
    lastName?: string;
    address?: {
      street?: string;
      city?: string;
    };
  };
}

const UserModel = fromType<UserProto>().defineModel(
  z.object({
    profile: z.object({
      firstName: z.string().min(1),      // ✅ optional → required
      lastName: z.string().min(1),       // ✅ optional → required
      address: z.object({
        street: z.string(),              // ✅ optional → required (nested)
        city: z.string(),                // ✅ optional → required (nested)
      }),
    }),
  })
);

// Result: all nested fields became required!
```

## Transformations

Zod allows transforming data during parsing:

### Simple transformations

```typescript
const GetUserModel = fromScratch().defineModel(
  z.object({
    id: z.string()
      .regex(/^\d+$/)
      .transform(val => parseInt(val, 10)),  // string → number
    email: z.string()
      .email()
      .transform(val => val.toLowerCase()),  // normalization
  })
);

const result = GetUserModel.parse({ id: '123', email: 'USER@EXAMPLE.COM' });
// result = { id: 123, email: 'user@example.com' }
```

### Transformations with existing types

```typescript
interface GetUserProto {
  id?: string;
  createdAt?: string;
}

const GetUserModel = fromType<GetUserProto>().defineModel(
  z.object({
    id: z.string().transform(val => parseInt(val, 10)),         // string → number
    createdAt: z.string().transform(val => new Date(val)),      // string → Date
  })
);

const result = GetUserModel.parse({ 
  id: '42', 
  createdAt: '2024-01-01T00:00:00Z' 
});
// result = { id: 42, createdAt: Date(...) }
```

### Cleaning Bearer tokens

```typescript
interface AuthProto {
  authorization?: string;
}

const AuthModel = fromType<AuthProto>().defineModel(
  z.object({
    authorization: z.string()
      .regex(/^Bearer .+$/)
      .transform(val => val.replace('Bearer ', '')),  // remove prefix
  })
);

const result = AuthModel.parse({ authorization: 'Bearer token123' });
// result = { authorization: 'token123' }
```

### Transformation chains

```typescript
const UserModel = fromScratch().defineModel(
  z.object({
    email: z.string()
      .email()
      .transform(val => val.toLowerCase())
      .transform(val => val.trim()),
  })
);

const result = UserModel.parse({ email: '  ALICE@EXAMPLE.COM  ' });
// result = { email: 'alice@example.com' }
```

## Validation and error handling

```typescript
import { z } from 'zod';

const UserModel = fromScratch().defineModel(
  z.object({
    name: z.string().min(1, 'Name cannot be empty'),
    age: z.number().min(0).max(150, 'Age must be between 0 and 150'),
  })
);

try {
  UserModel.parse({ name: '', age: 200 });
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error(error.issues);
    // [
    //   { path: ['name'], message: 'Name cannot be empty' },
    //   { path: ['age'], message: 'Age must be between 0 and 150' }
    // ]
  }
}
```

## Documenting models

Use `.describe()` to add descriptions that can be used for documentation generation (OpenAPI, JSON Schema, etc.):

```typescript
const UserModel = fromScratch().defineModel(
  z.object({
    name: z.string().min(1).max(100).describe('User name (required, 1-100 characters)'),
    email: z.string().email().describe('User email address'),
    role: z.enum(['admin', 'user', 'guest']).describe('User role in the system'),
  })
);

// Descriptions can be extracted for documentation generation
const schema = UserModel._def;  // contains all Zod metadata
```

## Transport integration

`@nestling/models` is designed to be used with Nestling transport layers (HTTP, CLI, gRPC, etc.).

Example usage with HTTP transport:

```typescript
import { fromType } from '@nestling/models';
import { z } from 'zod';

interface CreateUserProto {
  name?: string;
  email?: string;
}

const CreateUserModel = fromType<CreateUserProto>().defineModel(
  z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
  })
);

app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/users',
  handler: async (ctx) => {
    // Validation and parsing of input data
    const user = CreateUserModel.parse(ctx.payload);
    
    // user has strict type: { name: string; email: string }
    await saveUser(user);
    
    return { status: 201, value: { user } };
  }
});
```

For more details on transport integration, see [@nestling/transport](../nestling.transport/README.md) documentation.

## Usage examples

### Example 1: REST API model

```typescript
interface CreatePostProto {
  title?: string;
  content?: string;
  tags?: string[];
  publishedAt?: string;
}

const CreatePostModel = fromType<CreatePostProto>().defineModel(
  z.object({
    title: z.string().min(1).max(200),
    content: z.string().min(1),
    tags: z.array(z.string()).min(1).max(10),
    publishedAt: z.string()
      .datetime()
      .transform(val => new Date(val)),
  })
);
```

### Example 2: CLI arguments

```typescript
const CalcArgsModel = fromScratch().defineModel(
  z.object({
    a: z.string().transform(val => parseFloat(val)),
    b: z.string().transform(val => parseFloat(val)),
    operation: z.enum(['add', 'sub', 'mul', 'div']),
  })
);

// Usage
const args = CalcArgsModel.parse({
  a: '10',
  b: '5',
  operation: 'add'
});
// args = { a: 10, b: 5, operation: 'add' }
```

### Example 3: Request metadata

```typescript
interface AuthHeadersProto {
  authorization?: string;
  'x-request-id'?: string;
}

const AuthHeadersModel = fromType<AuthHeadersProto>().defineModel(
  z.object({
    authorization: z.string()
      .regex(/^Bearer .+$/)
      .transform(val => val.replace('Bearer ', '')),
    'x-request-id': z.string().uuid().optional(),
  })
);
```

## Connection with other Nestling packages

- **[@nestling/transport](../nestling.transport)** — uses `@nestling/models` for input data validation
- **[@nestling/container](../nestling.container)** — injects models as dependencies
- **[@nestling/viz](../nestling.viz)** — visualizes models in documentation

## FAQ

### Why not just use Zod directly?

You can! `@nestling/models` is a thin wrapper over Zod that adds:

1. **Type narrowing check** — guarantees that the schema matches the existing type
2. **Unified API** — `fromScratch()` and `fromType<T>()` explicitly show intentions
3. **Nestling integration** — ready-made patterns for working with transports

### Can I use other validators instead of Zod?

Technically yes, but currently the library is tightly integrated with Zod v4. Future support for other validators (Valibot, ArkType, etc.) is possible.

### What happens on validation error?

A standard `ZodError` is thrown with detailed information about the problems:

```typescript
try {
  UserModel.parse(invalidData);
} catch (error) {
  if (error instanceof z.ZodError) {
    error.issues.forEach(issue => {
      console.log(`${issue.path.join('.')}: ${issue.message}`);
    });
  }
}
```

### Can I use async validation?

Yes, use `.parseAsync()` instead of `.parse()`:

```typescript
const EmailModel = fromScratch().defineModel(
  z.object({
    email: z.string().email().refine(
      async (email) => await checkEmailUnique(email),
      { message: 'Email already in use' }
    ),
  })
);

const user = await EmailModel.parseAsync({ email: 'test@example.com' });
```

## License

MIT

## Additional resources

- 📖 [EXAMPLES.md](./EXAMPLES.md) — large collection of practical examples
- 📖 [SCHEMA.md](./SCHEMA.md) — details on working with schemas in the transport layer
- 📖 [Zod Documentation](https://zod.dev/)
- 📖 [Examples in repository](../../examples/)
