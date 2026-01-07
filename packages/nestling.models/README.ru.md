# @nestling/models

> 📖 **[English version](./README.md)**

**Type-safe модели ввода/вывода для приложений Nestling**

Библиотека для описания моделей данных с валидацией, автоматическим выводом типов, документацией и трансформациями. Построена на основе [Zod v4](https://github.com/colinhacks/zod).

## Зачем нужна эта библиотека?

При разработке приложений нам постоянно приходится работать с входными и выходными данными. Эти данные должны:

- ✅ **Иметь строгую типизацию** — чтобы TypeScript помогал отлавливать ошибки на этапе компиляции
- ✅ **Проходить валидацию** — чтобы защитить приложение от некорректных данных
- ✅ **Документироваться** — чтобы можно было генерировать OpenAPI спецификации
- ✅ **Трансформироваться** — чтобы преобразовывать строки в числа, даты, инстансы классов и т.д.

С этими задачами отлично справляется **Zod**, но возникает проблема в ситуации, когда **типы уже существуют** (например, сгенерированы из proto-контрактов, GraphQL схем или OpenAPI).

`@nestling/models` решает эту проблему, предоставляя два способа работы:

### 1. Создание моделей "с нуля" (`fromScratch`)

Когда типов еще нет, и они должны быть выведены из схемы:

```typescript
import { fromScratch } from '@nestling/models';
import { z } from 'zod';

const UserModel = fromScratch().makeModel(
  z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    age: z.number().min(0).max(150),
  })
);

// TypeScript автоматически выводит тип:
// type User = { name: string; email: string; age: number }

const user = UserModel.parse({
  name: 'Alice',
  email: 'alice@example.com',
  age: 30
});
```

### 2. Работа с существующими типами (`fromType`)

Когда у вас уже есть TypeScript типы (например, из proto), и вам нужно:
- Гарантировать, что схема полностью покрывает тип
- Добавить валидацию и трансформации
- Иметь возможность "сужать" типы (делать optional поля required)

```typescript
import { fromType } from '@nestling/models';
import { z } from 'zod';

// Тип уже существует (например, сгенерирован из proto)
interface UserProto {
  name?: string;
  email?: string;
  age?: number;
}

const UserModel = fromType<UserProto>().makeModel(
  z.object({
    name: z.string().min(1).max(100),    // optional → required
    email: z.string().email(),            // optional → required
    age: z.number().min(0).max(150),      // optional → required
  })
);

// Результирующий тип строже исходного:
// type User = { name: string; email: string; age: number }
// все поля стали обязательными!

const user = UserModel.parse({ name: 'Alice', email: 'alice@example.com', age: 30 });
```

## Установка

```bash
yarn add @nestling/models zod
# или
npm install @nestling/models zod
```

**Важно:** Библиотека требует `zod@^4.0.0` как peer dependency.

## Быстрый старт

### Два способа использования

#### 1️⃣ `fromScratch()` — типы выводятся из схемы

```typescript
import { fromScratch } from '@nestling/models';
import { z } from 'zod';

const UserModel = fromScratch().makeModel(
  z.object({
    name: z.string(),
    email: z.string().email(),
    age: z.number().min(18),
  })
);

// Тип автоматически: { name: string; email: string; age: number }
```

#### 2️⃣ `fromType<T>()` — работа с существующими типами

```typescript
import { fromType } from '@nestling/models';
import { z } from 'zod';

interface UserProto {
  name?: string;
  email?: string;
  age?: number;
}

const UserModel = fromType<UserProto>().makeModel(
  z.object({
    name: z.string(),      // ✅ optional → required (narrowing)
    email: z.string().email(),
    age: z.number().min(18),
  })
);

// Результат: { name: string; email: string; age: number }
// TypeScript гарантирует, что схема соответствует типу
```

### Основные возможности

#### ✅ Валидация

```typescript
try {
  const user = UserModel.parse(data);
} catch (error) {
  console.error(error.issues);
}
```

#### ✅ Трансформации

```typescript
const Model = fromScratch().makeModel(
  z.object({
    id: z.string().transform(val => parseInt(val, 10)),
    createdAt: z.string().transform(val => new Date(val)),
  })
);
```

#### ✅ Type Narrowing

```typescript
// ✅ Разрешено
optional → required
string → 'admin' | 'user'
number → number (min: 0, max: 100)

// ❌ Запрещено
Добавление полей, которых нет в типе
required → optional
Несовместимые типы (string → number)
```

#### ✅ Вложенные объекты

```typescript
const Model = fromType<UserProto>().makeModel(
  z.object({
    profile: z.object({
      firstName: z.string(),   // Narrowing работает рекурсивно
      address: z.object({
        city: z.string(),      // Вложенные поля тоже могут стать required
      }),
    }),
  })
);
```

#### ✅ Интеграция с транспортами

```typescript
app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/users',
  handler: async (ctx) => {
    const user = UserModel.parse(ctx.payload);  // Валидация + тип
    return { status: 201, value: { user } };
  }
});
```

## API

### `fromScratch()`

Создает модель без привязки к существующему типу. TypeScript автоматически выводит тип из схемы.

```typescript
const CalcModel = fromScratch().makeModel(
  z.object({
    a: z.number().describe('Первое число'),
    b: z.number().describe('Второе число'),
    operation: z.enum(['add', 'sub', 'mul', 'div']).describe('Операция'),
  })
);

// Вывод типа:
// { a: number; b: number; operation: 'add' | 'sub' | 'mul' | 'div' }
```

### `fromType<T>()`

Создает модель на основе существующего типа с поддержкой **type narrowing** (сужения типов).

#### Что такое Type Narrowing?

Narrowing позволяет:
- ✅ Делать optional поля обязательными (`string?` → `string`)
- ✅ Сужать типы (`string` → `'admin' | 'user'`)
- ✅ Добавлять ограничения (`number` → `number (min: 0, max: 100)`)
- ❌ НО запрещает добавлять новые поля, которых нет в исходном типе

```typescript
interface CreateUserProto {
  name?: string;
  email?: string;
  role?: string;
  age?: number;
}

const CreateUserModel = fromType<CreateUserProto>().makeModel(
  z.object({
    name: z.string().min(1),              // ✅ optional → required
    email: z.string().email(),            // ✅ optional → required
    role: z.enum(['admin', 'user']),      // ✅ string → enum (narrowing)
    age: z.number().min(18).max(100),     // ✅ добавление ограничений
  })
);

// Результат: { name: string; email: string; role: 'admin' | 'user'; age: number }
```

#### Что запрещено при Narrowing?

```typescript
interface UserProto {
  name?: string;
}

// ❌ ОШИБКА: нельзя добавлять поля, которых нет в типе
const BadModel = fromType<UserProto>().makeModel(
  z.object({
    name: z.string(),
    age: z.number(),  // ← Поля 'age' нет в UserProto!
  })
);

// ❌ ОШИБКА: нельзя менять тип несовместимым образом
const BadModel2 = fromType<UserProto>().makeModel(
  z.object({
    name: z.number(),  // ← name должен быть string, а не number
  })
);

// ❌ ОШИБКА: нельзя делать required поля optional
interface UserWithRequired {
  name: string;  // обязательное поле
}

const BadModel3 = fromType<UserWithRequired>().makeModel(
  z.object({
    name: z.string().optional(),  // ← нельзя сделать optional
  })
);
```

#### Работа с вложенными объектами

Narrowing работает рекурсивно для вложенных объектов:

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

const UserModel = fromType<UserProto>().makeModel(
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

// Результат: все вложенные поля стали обязательными!
```

## Трансформации

Zod позволяет трансформировать данные в процессе парсинга:

### Простые трансформации

```typescript
const GetUserModel = fromScratch().makeModel(
  z.object({
    id: z.string()
      .regex(/^\d+$/)
      .transform(val => parseInt(val, 10)),  // string → number
    email: z.string()
      .email()
      .transform(val => val.toLowerCase()),  // нормализация
  })
);

const result = GetUserModel.parse({ id: '123', email: 'USER@EXAMPLE.COM' });
// result = { id: 123, email: 'user@example.com' }
```

### Трансформации с существующими типами

```typescript
interface GetUserProto {
  id?: string;
  createdAt?: string;
}

const GetUserModel = fromType<GetUserProto>().makeModel(
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

### Очистка Bearer токенов

```typescript
interface AuthProto {
  authorization?: string;
}

const AuthModel = fromType<AuthProto>().makeModel(
  z.object({
    authorization: z.string()
      .regex(/^Bearer .+$/)
      .transform(val => val.replace('Bearer ', '')),  // убираем префикс
  })
);

const result = AuthModel.parse({ authorization: 'Bearer token123' });
// result = { authorization: 'token123' }
```

### Цепочки трансформаций

```typescript
const UserModel = fromScratch().makeModel(
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

## Валидация и обработка ошибок

```typescript
import { z } from 'zod';

const UserModel = fromScratch().makeModel(
  z.object({
    name: z.string().min(1, 'Имя не может быть пустым'),
    age: z.number().min(0).max(150, 'Возраст должен быть от 0 до 150'),
  })
);

try {
  UserModel.parse({ name: '', age: 200 });
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error(error.issues);
    // [
    //   { path: ['name'], message: 'Имя не может быть пустым' },
    //   { path: ['age'], message: 'Возраст должен быть от 0 до 150' }
    // ]
  }
}
```

## Документирование моделей

Используйте `.describe()` для добавления описаний, которые можно использовать для генерации документации (OpenAPI, JSON Schema и т.д.):

```typescript
const UserModel = fromScratch().makeModel(
  z.object({
    name: z.string().min(1).max(100).describe('Имя пользователя (обязательное, 1-100 символов)'),
    email: z.string().email().describe('Email адрес пользователя'),
    role: z.enum(['admin', 'user', 'guest']).describe('Роль пользователя в системе'),
  })
);

// Описания можно извлечь для генерации документации
const schema = UserModel._def;  // содержит все метаданные Zod
```

## Интеграция с транспортами

`@nestling/models` предназначен для использования с транспортными слоями Nestling (HTTP, CLI, gRPC и т.д.).

Пример использования с HTTP транспортом:

```typescript
import { fromType } from '@nestling/models';
import { z } from 'zod';

interface CreateUserProto {
  name?: string;
  email?: string;
}

const CreateUserModel = fromType<CreateUserProto>().makeModel(
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
    // Валидация и парсинг входных данных
    const user = CreateUserModel.parse(ctx.payload);
    
    // user имеет строгий тип: { name: string; email: string }
    await saveUser(user);
    
    return { status: 201, value: { user } };
  }
});
```

Более подробную информацию об интеграции с транспортами смотрите в документации [@nestling/transport](../nestling.transport/README.md).

## Примеры использования

### Пример 1: REST API модель

```typescript
interface CreatePostProto {
  title?: string;
  content?: string;
  tags?: string[];
  publishedAt?: string;
}

const CreatePostModel = fromType<CreatePostProto>().makeModel(
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

### Пример 2: CLI аргументы

```typescript
const CalcArgsModel = fromScratch().makeModel(
  z.object({
    a: z.string().transform(val => parseFloat(val)),
    b: z.string().transform(val => parseFloat(val)),
    operation: z.enum(['add', 'sub', 'mul', 'div']),
  })
);

// Использование
const args = CalcArgsModel.parse({
  a: '10',
  b: '5',
  operation: 'add'
});
// args = { a: 10, b: 5, operation: 'add' }
```

### Пример 3: Метаданные запроса

```typescript
interface AuthHeadersProto {
  authorization?: string;
  'x-request-id'?: string;
}

const AuthHeadersModel = fromType<AuthHeadersProto>().makeModel(
  z.object({
    authorization: z.string()
      .regex(/^Bearer .+$/)
      .transform(val => val.replace('Bearer ', '')),
    'x-request-id': z.string().uuid().optional(),
  })
);
```

## Связь с другими пакетами Nestling

- **[@nestling/transport](../nestling.transport)** — использует `@nestling/models` для валидации входных данных
- **[@nestling/container](../nestling.container)** — внедряет модели как зависимости
- **[@nestling/viz](../nestling.viz)** — визуализирует модели в документации

## FAQ

### Почему не просто использовать Zod напрямую?

Вы можете! `@nestling/models` — это тонкая обёртка над Zod, которая добавляет:

1. **Type narrowing проверку** — гарантирует, что схема соответствует существующему типу
2. **Единообразный API** — `fromScratch()` и `fromType<T>()` явно показывают намерения
3. **Интеграцию с Nestling** — готовые паттерны для работы с транспортами

### Можно ли использовать другие валидаторы вместо Zod?

Технически да, но сейчас библиотека тесно интегрирована с Zod v4. В будущем возможна поддержка других валидаторов (Valibot, ArkType и т.д.).

### Что происходит при ошибке валидации?

Выбрасывается стандартная `ZodError` с детальной информацией о проблемах:

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

### Можно ли использовать асинхронную валидацию?

Да, используйте `.parseAsync()` вместо `.parse()`:

```typescript
const EmailModel = fromScratch().makeModel(
  z.object({
    email: z.string().email().refine(
      async (email) => await checkEmailUnique(email),
      { message: 'Email уже используется' }
    ),
  })
);

const user = await EmailModel.parseAsync({ email: 'test@example.com' });
```

## Лицензия

MIT

## Дополнительные ресурсы

- 📖 [EXAMPLES.md](./EXAMPLES.md) — большая коллекция практических примеров
- 📖 [SCHEMA.md](./SCHEMA.md) — детали работы со схемами в транспортном слое
- 📖 [Документация Zod](https://zod.dev/)
- 📖 [Примеры в репозитории](../../examples/)

