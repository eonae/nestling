# Schema-Driven Input System

Система обработки входных данных для различных транспортов (HTTP, CLI, gRPC, Kafka и т.д.), которая работает proto-first и позволяет создавать строгие domain-модели с валидацией, сужением типов и автодокументацией.

## Основные концепции

### 1. InputSources

Два вида входных источников:

```typescript
type InputSources = {
  payload: Record<string, any>;   // объединение body + query + params
  metadata: Record<string, any>;  // auth, headers, tracing и т.п.
};
```

- **payload** — объединённые данные пользователя. Слияние body, query и params; при совпадении имён — выбрасывается ошибка.
- **metadata** — отдельные модели, transport-специфичные (headers, auth, tracing).

### 2. Domain Model vs Transport Type

- **Transport type (proto)**: может содержать optional поля, это особенность транспорта.
- **Domain model**: строгие типы, обязательные поля, инварианты.
- **Schema / InputDefinition**: описывает, как из payload и metadata строится domain model.

### 3. Schema / InputDefinition

Схема выполняет четыре задачи:

1. **Валидация** — проверяет данные на уровне domain (optional → required, правила внутри вложенных объектов).
2. **Описание типа** — если дженерик не указан, тип выводится из схемы (TS inference).
3. **Текстовое описание** — используется для генерации автодокументации.
4. **Сужение типа** — возможность изменить тип поля (например, optional address → required в domain).

## Принцип работы

```
transport payload (body/query/params)
        ↓  mergePayload()
validate(schema)  <- проверка обязательных полей, инвариантов
        ↓
domain object -> контроллер / сервис
```

- Transport больше не участвует в типизации.
- Schema полностью управляет типами и правилами.
- Metadata обрабатывается отдельно.

## RequestContext

Новая структура `RequestContext` объединяет все входные данные в `payload`:

```typescript
interface RequestContext {
  transport: string;
  method: string;
  path: string;
  
  // Структурированные данные (объединение body + query + params)
  payload?: unknown;
  
  // Метаданные транспорта (headers + transport-specific meta)
  metadata: Record<string, unknown>;
  
  // Для streaming cases
  streams?: {
    body?: Readable;      // Streaming body
    files?: FilePart[];   // Multipart файлы
  };
}
```

## Использование

### Базовый пример

```typescript
import { defineSchema, parsePayload, createInputSources } from '@nestling/transport';
import { z } from 'zod';

// 1. Определяем proto-тип (может быть из ts-proto)
interface CreateUserProto {
  name?: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
  };
}

// 2. Определяем domain схему (сужаем типы)
const CreateUserSchema = defineSchema<CreateUserProto>({
  name: { 
    validator: z.string().min(1).max(100), 
    description: "Имя пользователя" 
  },
  email: { 
    validator: z.string().email(), 
    description: "Email адрес" 
  },
  address: { 
    validator: z.object({
      street: z.string().min(1),
      city: z.string().min(1)
    }), 
    description: "Адрес пользователя" 
  }
});

// 3. Используем в handler
app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/users',
  input: { body: 'json' },
  handler: async (ctx) => {
    // ctx.payload уже содержит объединённые body + query + params
    const sources = createInputSources(ctx);
    const user = parsePayload(CreateUserSchema, sources);
    
    // user имеет тип:
    // { name: string; email: string; address: { street: string; city: string } }
    // address теперь обязателен!
    
    return {
      status: 201,
      value: { user },
      meta: {}
    };
  }
});
```

### Type Inference

Если дженерик не указан, TypeScript автоматически выведет тип из валидаторов:

```typescript
const CalcSchema = defineSchema({
  a: { validator: z.number(), description: "Первое число" },
  b: { validator: z.number(), description: "Второе число" },
  operation: { validator: z.enum(['add', 'sub', 'mul', 'div']), description: "Операция" }
});

// Тип выводится автоматически:
// { a: number; b: number; operation: 'add' | 'sub' | 'mul' | 'div' }
```

### Работа с Metadata

Metadata обрабатывается отдельной схемой:

```typescript
const AuthSchema = defineSchema({
  authorization: {
    validator: z.string().regex(/^Bearer .+$/)
      .transform((val: string) => val.replace('Bearer ', '')),
    description: 'Bearer токен из заголовка Authorization'
  },
  userId: {
    validator: z.string().optional(),
    description: 'ID пользователя из заголовка X-User-Id'
  }
});

app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/users/secure',
  input: { body: 'json' },
  handler: async (ctx) => {
    const sources = createInputSources(ctx);
    const user = parsePayload(CreateUserSchema, sources);
    const auth = parseMetadata(AuthSchema, sources);
    
    // auth имеет тип: { authorization: string; userId?: string }
    // authorization уже очищен от префикса "Bearer "
    
    return {
      status: 201,
      value: { user, token: auth.authorization },
      meta: {}
    };
  }
});
```

### Объединение body, query и params

Функция `mergePayload` автоматически объединяет все источники:

```typescript
// GET /users/:id?include=profile
app.registerHandler({
  transport: 'http',
  method: 'GET',
  path: '/users/:id',
  handler: async (ctx) => {
    const sources = createInputSources(ctx);
    // sources.payload содержит объединённые:
    // - params.id (из path)
    // - query.include (из URL)
    
    const GetUserSchema = defineSchema({
      id: {
        validator: z.string().transform((val: string) => Number.parseInt(val, 10)),
        description: 'ID пользователя из path параметра'
      },
      include: {
        validator: z.enum(['profile', 'posts']).optional(),
        description: 'Дополнительные данные для включения'
      }
    });
    
    const input = parsePayload(GetUserSchema, sources);
    // input имеет тип: { id: number; include?: 'profile' | 'posts' }
  }
});
```

### Сужение типов (strict domain)

В schema можно сделать optional proto-поле обязательным:

```typescript
// gRPC: address?: Address
const UserSchema = defineSchema<UserGrpc>({
  address: { 
    validator: z.object({ 
      street: z.string(), 
      city: z.string() 
    }), 
    description: "Обязательный адрес" 
  }
});

// domain: address обязательно
type UserDomain = DomainType<typeof UserSchema>;
// UserDomain.address: Address (не optional!)
```

Валидация гарантирует, что `address` не `undefined`.

### Генерация документации

Каждое поле в схеме имеет `description`. Можно извлекать описания для генерации OpenAPI или Markdown:

```typescript
import { extractDescription } from '@nestling/transport';

const descriptions = extractDescription(CreateUserSchema);
// {
//   name: "Имя пользователя",
//   email: "Email адрес",
//   address: "Адрес пользователя"
// }
```

## API Reference

### `defineSchema<T>(fields)`

Определяет схему для валидации и типизации.

**Параметры:**
- `fields` - объект с описаниями полей

**Возвращает:** `SchemaDefinition<T>`

**Пример:**
```typescript
const schema = defineSchema<UserProto>({
  name: { validator: z.string().min(1), description: "Имя" }
});
```

### `parsePayload<S>(schema, sources)`

Парсит и валидирует payload согласно схеме.

**Параметры:**
- `schema` - схема для валидации
- `sources` - источники входных данных

**Возвращает:** `DomainType<S>` - строго типизированный domain объект

**Бросает:** `SchemaValidationError` если валидация не прошла

### `parseMetadata<S>(schema, sources)`

Парсит и валидирует metadata согласно схеме.

**Параметры:**
- `schema` - схема для валидации metadata
- `sources` - источники входных данных

**Возвращает:** `DomainType<S>` - строго типизированный metadata объект

**Бросает:** `SchemaValidationError` если валидация не прошла

### `mergePayload(body, query, params)`

Объединяет body, query и params в единый payload объект.

**Параметры:**
- `body` - тело запроса (обычно JSON)
- `query` - query параметры из URL
- `params` - path параметры из маршрута

**Возвращает:** `Record<string, any>` - объединённый объект payload

**Бросает:** `Error` если обнаружены дублирующиеся ключи

### `createInputSources(ctx)`

Создаёт InputSources из RequestContext.

**Параметры:**
- `ctx` - контекст запроса (с уже объединённым payload)

**Возвращает:** `InputSources`

**Примечание:** Транспорты автоматически объединяют body, query и params в `ctx.payload`, поэтому эта функция просто извлекает payload и metadata из контекста.

### `extractDescription(schema)`

Извлекает описания полей из схемы для генерации документации.

**Параметры:**
- `schema` - схема

**Возвращает:** `Record<string, string | undefined>`

## Best Practices

### 1. Proto-first подход

Всегда начинайте с proto-типа (может быть из ts-proto):

```typescript
// ✅ Хорошо
interface UserProto {
  name?: string;
  email?: string;
}

const UserSchema = defineSchema<UserProto>({
  name: { validator: z.string().min(1) },
  email: { validator: z.string().email() }
});
```

### 2. Разделение payload и metadata

Используйте отдельные схемы для payload и metadata:

```typescript
// ✅ Хорошо
const user = parsePayload(UserSchema, sources);
const auth = parseMetadata(AuthSchema, sources);
```

### 3. Сужение типов в domain

Делайте обязательными поля, которые должны быть обязательными в domain:

```typescript
// ✅ Хорошо - сужаем optional → required
const UserSchema = defineSchema<UserProto>({
  email: { 
    validator: z.string().email(), // обязательный в domain
    description: "Email (обязателен)" 
  }
});
```

### 4. Используйте описания

Всегда добавляйте `description` для генерации документации:

```typescript
// ✅ Хорошо
const UserSchema = defineSchema({
  name: { 
    validator: z.string().min(1),
    description: "Имя пользователя (обязательное, 1-100 символов)"
  }
});
```

### 5. Трансформации данных

Используйте Zod transform для преобразования данных:

```typescript
// ✅ Хорошо - преобразуем string → number
const GetUserSchema = defineSchema({
  id: {
    validator: z.string().transform((val: string) => Number.parseInt(val, 10)),
    description: "ID пользователя"
  }
});
```

## Интеграция с транспортами

### HTTP Transport

HTTP транспорт автоматически объединяет body, query и params в `ctx.payload`:

```typescript
// POST /users/:id?include=profile
// Body: { name: "Alice", email: "alice@example.com" }
// ctx.payload = {
//   id: "123",               // из params
//   include: "profile",      // из query
//   name: "Alice",           // из body
//   email: "alice@example.com"
// }

const sources = createInputSources(ctx);
// sources.payload содержит все объединённые данные
```

### CLI Transport

CLI транспорт структурирует данные в `ctx.payload`:

```typescript
// Команда: calc 10 5 --op add
// ctx.payload = {
//   args: ["10", "5"],
//   op: "add"
// }

const sources = createInputSources(ctx);
// sources.payload содержит args и options
```

### Streaming Mode

Для streaming данных используйте `ctx.streams`:

```typescript
app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/upload',
  input: { body: 'stream' },
  handler: async (ctx) => {
    // ctx.payload будет пустым или с минимальными данными
    // ctx.streams.body содержит Readable stream
    
    if (ctx.streams?.body) {
      // Обрабатываем stream
      await processStream(ctx.streams.body);
    }
    
    return { status: 200, value: { success: true }, meta: {} };
  }
});
```

## Обработка ошибок

При ошибке валидации выбрасывается `SchemaValidationError`:

```typescript
import { SchemaValidationError } from '@nestling/transport';

try {
  const user = parsePayload(UserSchema, sources);
} catch (error) {
  if (error instanceof SchemaValidationError) {
    console.error('Validation failed:', error.message);
    console.error('Zod errors:', error.zodError.issues);
  }
}
```

## Примеры

Полные примеры использования доступны в:
- `packages/examples.simple-http-server/src/main.ts` - HTTP примеры
- `packages/examples.simple-cli/src/main.ts` - CLI примеры
- `packages/examples.schema-demo/src/main.ts` - комплексная демонстрация

## Зависимости

Система требует `zod` как peer dependency:

```json
{
  "peerDependencies": {
    "zod": "^4.0.0"
  }
}
```

Установите zod в вашем проекте:

```bash
yarn add zod
```

