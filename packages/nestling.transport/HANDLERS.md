# Handler-классы с полной проверкой типов

## Проблема

Декораторы методов `@Endpoint` в TypeScript **не могут** проверять соответствие типов параметров метода и схем из-за ограничений системы типов.

```typescript
// ❌ TypeScript НЕ проверяет типы параметров!
@Endpoint({
  payloadSchema: z.object({ name: z.string() }),
})
async handle(payload: { wrong: number }) { // Ошибки НЕТ!
  // ...
}
```

## Решение

Есть два подхода для создания handlers с полной проверкой типов:

### Подход 1: Функциональный стиль (`app.registerHandler`)

Используйте `app.registerHandler()` с объектом конфигурации. Типы выводятся автоматически из схем:

```typescript
import { z } from 'zod';
import { App, HttpTransport } from '@nestling/transport';

const app = new App({
  http: new HttpTransport({ port: 3000 }),
});

const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
});

const CreateUserResponseSchema = z.object({
  message: z.string(),
  user: z.object({
    id: z.number(),
    name: z.string(),
    email: z.string(),
  }),
});

app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/users',
  input: { body: 'json' },
  payloadSchema: CreateUserSchema,
  responseSchema: CreateUserResponseSchema,
  handler: async (payload) => {
    // payload имеет правильный тип: { name: string; email: string }
    return {
      status: 201,
      value: {
        message: 'User created',
        user: {
          id: Math.floor(Math.random() * 1000),
          ...payload,
        },
      },
      meta: {},
    };
  },
});
```

### Подход 2: Классовый стиль (`@Handler`)

Используйте декоратор `@Handler` на **классах**. TypeScript проверяет **форму класса** через constraint на конструктор:

```typescript
@Handler({
  transport: 'http',
  method: 'GET',
  path: '/users/:id',
  payloadSchema: PayloadSchema,
  metadataSchema: MetadataSchema,
  responseSchema: ResponseSchema,
})
class GetUser {
  async handle(payload, metadata) {
    // ✅ Типы выводятся АВТОМАТИЧЕСКИ из схем!
    // ✅ TypeScript ПРОВЕРЯЕТ соответствие схемам!
    return {
      status: 200,
      value: { ... },
      meta: {},
    };
  }
}
```

## Пример использования

```typescript
import { z } from 'zod';
import { Handler, App, HttpTransport } from '@nestling/transport';

// 1. Определяем схемы
const GetUserPayloadSchema = z.object({
  id: z.string().transform(val => parseInt(val, 10)),
  include: z.enum(['profile', 'posts']).optional(),
});

const AuthMetadataSchema = z.object({
  authorization: z.string(),
});

const UserResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
});

// 2. Создаём handler-класс
@Handler({
  transport: 'http',
  method: 'GET',
  path: '/users/:id',
  payloadSchema: GetUserPayloadSchema,
  metadataSchema: AuthMetadataSchema,
  responseSchema: UserResponseSchema,
})
class GetUser {
  async handle(
    payload: { id: number; include?: 'profile' | 'posts' },
    metadata: { authorization: string },
  ) {
    // TypeScript ПРОВЕРЯЕТ эти типы!
    // Если типы не совпадут со схемами - будет ошибка компиляции!
    
    return {
      status: 200,
      value: {
        id: payload.id,
        name: `User ${payload.id}`,
        email: `user${payload.id}@example.com`,
      },
      meta: {},
    };
  }
}

// 3. Регистрируем в App
const app = new App({
  http: new HttpTransport({ port: 3000 }),
});

app.registerHandler(GetUser);
// или несколько: app.registerHandlers([GetUser, CreateUser, DeleteUser]);

await app.listen();
```

## Что проверяется?

### ✅ Наличие метода `handle`

```typescript
@Handler({ ... })
class MyHandler {
  // ❌ Ошибка: Property 'handle' is missing in type 'MyHandler'
}
```

### ✅ Типы параметров

```typescript
@Handler({
  payloadSchema: z.object({ name: z.string() }),
  ...
})
class MyHandler {
  // ❌ Ошибка: Types of parameters 'payload' and 'payload' are incompatible
  async handle(payload: { wrong: number }) { ... }
}
```

### ✅ Тип возвращаемого значения

```typescript
@Handler({
  responseSchema: z.object({ name: z.string() }),
  ...
})
class MyHandler {
  async handle(payload, metadata) {
    // ❌ Ошибка: Type '{ wrong: boolean }' is not assignable to type '{ name: string }'
    return {
      status: 200,
      value: { wrong: true },
      meta: {},
    };
  }
}
```

## Сравнение подходов

| Подход | Проверка типов | Изоляция логики | Один endpoint = |
|--------|----------------|----------------|-----------------|
| `app.registerHandler()` | ✅ Полная | ❌ Нет | Функция |
| `@Handler` | ✅ Полная | ✅ Да | Класс |

## Преимущества подходов

### `app.registerHandler()` (функциональный стиль)
1. **Полная проверка типов** - TypeScript проверяет всё на этапе компиляции
2. **Простота** - не нужно создавать классы, всё в одном месте
3. **Компактность** - идеально для простых endpoints

### `@Handler` (классовый стиль)
1. **Полная проверка типов** - TypeScript проверяет всё на этапе компиляции
2. **Single Responsibility** - один класс = один endpoint
3. **Изоляция логики** - вся логика endpoint'а в одном классе
4. **Тестируемость** - легко создать инстанс и протестировать
5. **Расширяемость** - можно добавлять методы, поля, DI

## Как это работает?

`@Handler` применяется к **конструктору класса**, а не к методу. TypeScript проверяет, что конструктор создаёт объект с правильной формой:

```typescript
type HandlerClass<TPayload, TMetadata, TResponse> = new (...args: any[]) => {
  handle(
    payload: TPayload,
    metadata: TMetadata,
  ): Promise<ResponseContext & { value?: TResponse }>;
};
```

Constraint `T extends HandlerClass<...>` проверяет всю структуру класса, включая сигнатуру метода `handle`!

## Миграция с @Controller

**Было (старый подход):**
```typescript
@Controller('/users')
class UserController {
  @Endpoint({ method: 'GET', path: '/:id' })
  async getById(payload: any) { ... }
  
  @Endpoint({ method: 'POST', path: '/' })
  async create(payload: any) { ... }
}
```

**Стало (новый подход):**
```typescript
@Handler({
  transport: 'http',
  method: 'GET',
  path: '/users/:id',
  payloadSchema: GetUserPayloadSchema,
  metadataSchema: MetadataSchema,
  responseSchema: UserResponseSchema,
})
class GetUser {
  async handle(payload, metadata) { ... }
}

@Handler({
  transport: 'http',
  method: 'POST',
  path: '/users',
  payloadSchema: CreateUserPayloadSchema,
  metadataSchema: MetadataSchema,
  responseSchema: UserResponseSchema,
})
class CreateUser {
  async handle(payload, metadata) { ... }
}

// Регистрация
app.registerHandlers([GetUser, CreateUser]);
```

## Лучшие практики

1. **Именование**: `<Verb><Resource>` (GetUser, CreateProduct, DeleteOrder)
2. **Один файл = один handler**: `get-user.handler.ts`
3. **Схемы рядом**: определяйте схемы в том же файле
4. **DI**: используйте `@Injectable` для внедрения зависимостей
5. **Тестирование**: создавайте инстанс и тестируйте метод `handle()`

