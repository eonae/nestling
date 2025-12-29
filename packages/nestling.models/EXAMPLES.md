# Примеры использования @nestling/models

Коллекция практических примеров для копирования и адаптации под свои нужды.

## Содержание

- [Базовые модели](#базовые-модели)
- [Трансформации](#трансформации)
- [Type Narrowing](#type-narrowing)
- [REST API модели](#rest-api-модели)
- [CLI модели](#cli-модели)
- [Метаданные и заголовки](#метаданные-и-заголовки)
- [Продвинутые сценарии](#продвинутые-сценарии)

---

## Базовые модели

### Простая модель пользователя

```typescript
import { fromScratch } from '@nestling/models';
import { z } from 'zod';

const UserModel = fromScratch().defineModel(
  z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(100),
    email: z.string().email(),
    age: z.number().min(0).max(150).optional(),
    createdAt: z.string().datetime(),
  })
);

// Использование
const user = UserModel.parse({
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Alice',
  email: 'alice@example.com',
  age: 30,
  createdAt: '2024-01-01T00:00:00Z',
});
```

### Модель с enum

```typescript
const TaskModel = fromScratch().defineModel(
  z.object({
    title: z.string().min(1),
    status: z.enum(['todo', 'in_progress', 'done']),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
    tags: z.array(z.string()).default([]),
  })
);
```

### Модель с вложенными объектами

```typescript
const OrderModel = fromScratch().defineModel(
  z.object({
    orderId: z.string(),
    customer: z.object({
      name: z.string(),
      email: z.string().email(),
      phone: z.string().regex(/^\+?[\d\s-()]+$/),
    }),
    items: z.array(
      z.object({
        productId: z.string(),
        quantity: z.number().min(1),
        price: z.number().positive(),
      })
    ),
    shippingAddress: z.object({
      street: z.string(),
      city: z.string(),
      postalCode: z.string(),
      country: z.string().length(2), // ISO код
    }),
  })
);
```

---

## Трансформации

### Парсинг строк в числа

```typescript
const CalculatorModel = fromScratch().defineModel(
  z.object({
    a: z.string().transform(val => parseFloat(val)),
    b: z.string().transform(val => parseFloat(val)),
    operation: z.enum(['add', 'sub', 'mul', 'div']),
  })
);

// Использование
const input = CalculatorModel.parse({ a: '10', b: '5', operation: 'add' });
// input = { a: 10, b: 5, operation: 'add' }
```

### Парсинг дат

```typescript
const EventModel = fromScratch().defineModel(
  z.object({
    title: z.string(),
    startDate: z.string().datetime().transform(val => new Date(val)),
    endDate: z.string().datetime().transform(val => new Date(val)),
  })
);
```

### Нормализация данных

```typescript
const EmailModel = fromScratch().defineModel(
  z.object({
    email: z.string()
      .email()
      .transform(val => val.toLowerCase())
      .transform(val => val.trim()),
    username: z.string()
      .min(3)
      .transform(val => val.toLowerCase().replace(/\s+/g, '_')),
  })
);

// Использование
const user = EmailModel.parse({
  email: '  ALICE@EXAMPLE.COM  ',
  username: 'Alice Smith',
});
// user = { email: 'alice@example.com', username: 'alice_smith' }
```

### Очистка Bearer токенов

```typescript
const AuthModel = fromScratch().defineModel(
  z.object({
    token: z.string()
      .regex(/^Bearer .+$/, 'Token must start with "Bearer "')
      .transform(val => val.replace('Bearer ', '')),
  })
);

// Использование
const auth = AuthModel.parse({ token: 'Bearer abc123xyz' });
// auth = { token: 'abc123xyz' }
```

### Парсинг JSON строк

```typescript
const ConfigModel = fromScratch().defineModel(
  z.object({
    settings: z.string()
      .transform(val => JSON.parse(val))
      .pipe(
        z.object({
          theme: z.enum(['light', 'dark']),
          language: z.string(),
        })
      ),
  })
);
```

---

## Type Narrowing

### Optional → Required

```typescript
interface UserProto {
  name?: string;
  email?: string;
  phone?: string;
}

const StrictUserModel = fromType<UserProto>().defineModel(
  z.object({
    name: z.string().min(1),     // ✅ обязательное
    email: z.string().email(),   // ✅ обязательное
    phone: z.string().optional(), // ✅ остаётся optional
  })
);
```

### String → Enum (сужение типа)

```typescript
interface UserProto {
  role?: string;
}

const UserWithRoleModel = fromType<UserProto>().defineModel(
  z.object({
    role: z.enum(['admin', 'user', 'guest']), // ✅ сужение string → enum
  })
);
```

### Добавление ограничений

```typescript
interface ProductProto {
  price?: number;
  quantity?: number;
}

const ValidatedProductModel = fromType<ProductProto>().defineModel(
  z.object({
    price: z.number().positive().max(1000000),  // ✅ добавление ограничений
    quantity: z.number().int().min(0).max(9999),
  })
);
```

### Вложенные объекты с narrowing

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

const CompleteUserModel = fromType<UserProto>().defineModel(
  z.object({
    profile: z.object({
      firstName: z.string().min(1),  // ✅ optional → required
      lastName: z.string().min(1),   // ✅ optional → required
      address: z.object({
        street: z.string(),          // ✅ nested optional → required
        city: z.string(),            // ✅ nested optional → required
      }),
    }),
  })
);
```

---

## REST API модели

### POST /users — создание пользователя

```typescript
interface CreateUserProto {
  name?: string;
  email?: string;
  password?: string;
  role?: string;
}

const CreateUserModel = fromType<CreateUserProto>().defineModel(
  z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    password: z.string().min(8).max(128).regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain uppercase, lowercase, and number'
    ),
    role: z.enum(['user', 'admin']).default('user'),
  })
);
```

### GET /users/:id — получение пользователя

```typescript
interface GetUserProto {
  id?: string;
  include?: string;
}

const GetUserModel = fromType<GetUserProto>().defineModel(
  z.object({
    id: z.string()
      .regex(/^\d+$/)
      .transform(val => parseInt(val, 10)),
    include: z.enum(['profile', 'posts', 'comments']).optional(),
  })
);
```

### PATCH /users/:id — обновление пользователя

```typescript
interface UpdateUserProto {
  id?: string;
  name?: string;
  email?: string;
  bio?: string;
}

const UpdateUserModel = fromType<UpdateUserProto>().defineModel(
  z.object({
    id: z.string().transform(val => parseInt(val, 10)),
    name: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    bio: z.string().max(500).optional(),
  }).refine(
    data => data.name || data.email || data.bio,
    'At least one field must be provided'
  )
);
```

### POST /posts — создание поста с тегами

```typescript
interface CreatePostProto {
  title?: string;
  content?: string;
  tags?: string[];
  publishedAt?: string;
  isDraft?: boolean;
}

const CreatePostModel = fromType<CreatePostProto>().defineModel(
  z.object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(10000),
    tags: z.array(z.string().min(1)).min(1).max(10),
    publishedAt: z.string()
      .datetime()
      .transform(val => new Date(val))
      .optional(),
    isDraft: z.boolean().default(false),
  })
);
```

---

## CLI модели

### Простая калькулятор-команда

```typescript
const CalcArgsModel = fromScratch().defineModel(
  z.object({
    a: z.string().transform(val => parseFloat(val)),
    b: z.string().transform(val => parseFloat(val)),
    operation: z.enum(['add', 'sub', 'mul', 'div']),
  })
);

// CLI: calc 10 5 --operation add
```

### Команда с опциями

```typescript
const BuildCommandModel = fromScratch().defineModel(
  z.object({
    target: z.string().default('dist'),
    mode: z.enum(['development', 'production']).default('development'),
    watch: z.boolean().default(false),
    sourcemap: z.boolean().default(false),
    minify: z.boolean().default(false),
  })
);

// CLI: build --mode production --minify --target build
```

### Команда с файлами

```typescript
const ProcessFilesModel = fromScratch().defineModel(
  z.object({
    input: z.array(z.string()).min(1),
    output: z.string(),
    format: z.enum(['json', 'csv', 'xml']).default('json'),
    verbose: z.boolean().default(false),
  })
);

// CLI: process-files input1.txt input2.txt --output result.json --format json
```

---

## Метаданные и заголовки

### HTTP заголовки аутентификации

```typescript
interface AuthHeadersProto {
  authorization?: string;
  'x-api-key'?: string;
  'x-request-id'?: string;
}

const AuthHeadersModel = fromType<AuthHeadersProto>().defineModel(
  z.object({
    authorization: z.string()
      .regex(/^Bearer .+$/)
      .transform(val => val.replace('Bearer ', '')),
    'x-api-key': z.string().optional(),
    'x-request-id': z.string().uuid().optional(),
  })
);
```

### Pagination заголовки

```typescript
interface PaginationProto {
  page?: string;
  limit?: string;
  sortBy?: string;
  order?: string;
}

const PaginationModel = fromType<PaginationProto>().defineModel(
  z.object({
    page: z.string()
      .transform(val => parseInt(val, 10))
      .pipe(z.number().min(1))
      .default('1'),
    limit: z.string()
      .transform(val => parseInt(val, 10))
      .pipe(z.number().min(1).max(100))
      .default('20'),
    sortBy: z.string().default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
);
```

---

## Продвинутые сценарии

### Conditional validation

```typescript
const PaymentModel = fromScratch().defineModel(
  z.object({
    method: z.enum(['card', 'paypal', 'crypto']),
    cardNumber: z.string().optional(),
    paypalEmail: z.string().email().optional(),
    walletAddress: z.string().optional(),
  }).refine(
    data => {
      if (data.method === 'card') return !!data.cardNumber;
      if (data.method === 'paypal') return !!data.paypalEmail;
      if (data.method === 'crypto') return !!data.walletAddress;
      return false;
    },
    { message: 'Missing required payment details for selected method' }
  )
);
```

### Async validation

```typescript
const EmailUniqueModel = fromScratch().defineModel(
  z.object({
    email: z.string().email().refine(
      async (email) => {
        const exists = await checkEmailExists(email);
        return !exists;
      },
      { message: 'Email already in use' }
    ),
  })
);

// Использование
const user = await EmailUniqueModel.parseAsync({ email: 'test@example.com' });
```

### Union types

```typescript
const NotificationModel = fromScratch().defineModel(
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('email'),
      to: z.string().email(),
      subject: z.string(),
      body: z.string(),
    }),
    z.object({
      type: z.literal('sms'),
      phone: z.string(),
      message: z.string().max(160),
    }),
    z.object({
      type: z.literal('push'),
      deviceId: z.string(),
      title: z.string(),
      body: z.string(),
    }),
  ])
);
```

### Recursive schemas (для древовидных структур)

```typescript
type Category = {
  id: string;
  name: string;
  children?: Category[];
};

const CategoryModel: z.ZodType<Category> = fromScratch().defineModel(
  z.lazy(() =>
    z.object({
      id: z.string(),
      name: z.string(),
      children: z.array(CategoryModel).optional(),
    })
  )
);
```

### Transform с validation после

```typescript
const AgeModel = fromScratch().defineModel(
  z.object({
    age: z.string()
      .transform(val => parseInt(val, 10))
      .pipe(z.number().min(0).max(150)),
  })
);

// Сначала трансформация string → number,
// затем валидация диапазона
```

### Custom error messages

```typescript
const PasswordModel = fromScratch().defineModel(
  z.object({
    password: z.string()
      .min(8, 'Пароль должен содержать минимум 8 символов')
      .max(128, 'Пароль не должен превышать 128 символов')
      .regex(/[a-z]/, 'Пароль должен содержать строчные буквы')
      .regex(/[A-Z]/, 'Пароль должен содержать заглавные буквы')
      .regex(/\d/, 'Пароль должен содержать цифры')
      .regex(/[@$!%*?&#]/, 'Пароль должен содержать спецсимволы'),
  })
);
```

---

## Паттерны использования

### Handler с валидацией

```typescript
app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/users',
  handler: async (ctx) => {
    try {
      const user = CreateUserModel.parse(ctx.payload);
      const result = await userService.create(user);
      return { status: 201, value: result };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          status: 400,
          value: { errors: error.issues }
        };
      }
      throw error;
    }
  }
});
```

### Переиспользуемые части схем

```typescript
// Общие части
const addressSchema = z.object({
  street: z.string(),
  city: z.string(),
  postalCode: z.string(),
  country: z.string().length(2),
});

const contactSchema = z.object({
  email: z.string().email(),
  phone: z.string().regex(/^\+?[\d\s-()]+$/),
});

// Использование в моделях
const UserModel = fromScratch().defineModel(
  z.object({
    name: z.string(),
    contact: contactSchema,
    address: addressSchema,
  })
);

const CompanyModel = fromScratch().defineModel(
  z.object({
    companyName: z.string(),
    legalAddress: addressSchema,
    billingAddress: addressSchema,
    contact: contactSchema,
  })
);
```

---

Больше примеров смотрите в:
- `packages/examples.simple-http-server/src/main.ts`
- `packages/examples.simple-cli/src/main.ts`
- [Zod Documentation](https://zod.dev/)

