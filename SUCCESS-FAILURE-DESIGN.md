# Архитектура Success/Failure для обработки результатов

## Обзор

Новая архитектура явно разделяет успешные результаты и ошибки через классы `Success` и `Failure`. Это улучшает type safety, делает API более понятным и обеспечивает централизованную обработку ошибок.

## Мотивация

### Проблемы старого подхода

До изменений endpoints возвращали `ResponseContext` с полем `status`:

```typescript
// Старый подход
async handle(payload, metadata): Promise<ResponseContext> {
  if (!authorized) {
    return {
      status: 'UNAUTHORIZED',
      value: null,
    };
  }
  
  return {
    status: 'OK',
    value: data,
  };
}
```

**Недостатки:**
- Нет четкого разделения между успехом и ошибкой на уровне типов
- Можно случайно вернуть статус ошибки с валидными данными
- Нет централизованной обработки исключений
- Смешение транспортной логики (ResponseContext) с бизнес-логикой

### Новый подход

```typescript
// Новый подход
async handle(payload, metadata): Output<UserData> {
  if (!authorized) {
    throw Failure.unauthorized('Authorization required');
  }
  
  // Вариант 1: Явный Success
  return WrappedSuccess.ok(data);
  
  // Вариант 2: Автоматический WrappedSuccess.ok
  return data;
}
```

**Преимущества:**
- ✅ Явное разделение Success/Failure на уровне типов
- ✅ Централизованная обработка ошибок в Pipeline
- ✅ Удобный API с фабричными методами
- ✅ Separation of Concerns: публичный API отделен от транспортного слоя

## Архитектура

### 1. Разделение статусов

Статусы делятся на три типа:

```typescript
// packages/nestling.pipeline/src/core/status.ts

// Успешные статусы (2xx)
export const successStatuses = [
  'OK',           // 200
  'CREATED',      // 201
  'ACCEPTED',     // 202
  'NO_CONTENT',   // 204
] as const;

// Статусы ошибок (4xx, 5xx)
export const errorStatuses = [
  'PAYMENT_REQUIRED',      // 402
  'BAD_REQUEST',           // 400
  'UNAUTHORIZED',          // 401
  'FORBIDDEN',             // 403
  'NOT_FOUND',             // 404
  'INTERNAL_ERROR',        // 500
  'NOT_IMPLEMENTED',       // 501
  'SERVICE_UNAVAILABLE',   // 503
] as const;

// Все статусы (для внутреннего использования в транспортах)
export const statuses = [...successStatuses, ...errorStatuses] as const;

export type SuccessStatus = (typeof successStatuses)[number];
export type ErrorStatus = (typeof errorStatuses)[number];
export type ProcessingStatus = (typeof statuses)[number];
```

**Использование:**
- `SuccessStatus` — только для класса Success
- `ErrorStatus` — только для класса Failure
- `ProcessingStatus` — для транспортного слоя (ResponseContext)

### 2. Класс Success

Представляет успешный результат обработки.

```typescript
// packages/nestling.pipeline/src/core/result.ts

/**
 * Успешный результат обработки
 * Используется для возврата данных с успешным статусом
 */
export class Success<TValue = unknown> {
  constructor(
    public readonly status: SuccessStatus,
    public readonly value: TValue,
    public readonly headers?: Record<string, string>,
  ) {}

  /**
   * Фабричные методы для типовых успешных ответов
   */
  static ok<T>(value: T, headers?: Record<string, string>): Success<T> {
    return new Success('OK', value, headers);
  }

  static created<T>(value: T, headers?: Record<string, string>): Success<T> {
    return new Success('CREATED', value, headers);
  }

  static accepted<T>(value: T, headers?: Record<string, string>): Success<T> {
    return new Success('ACCEPTED', value, headers);
  }

  static noContent(headers?: Record<string, string>): Success<null> {
    return new Success('NO_CONTENT', null, headers);
  }
}
```

**Особенности:**
- Типизированное поле `value`
- Опциональные HTTP заголовки
- Фабричные методы для удобства
- Immutable (все поля readonly)

### 3. Класс Failure

Представляет ошибку обработки запроса.

```typescript
// packages/nestling.pipeline/src/core/result.ts

/**
 * Ошибка обработки запроса
 * Бросается как исключение и автоматически преобразуется в ResponseContext
 */
export class Failure extends Error {
  constructor(
    public readonly status: ErrorStatus,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'Failure';
    
    // Поддержка правильного stack trace в V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, Failure);
    }
  }

  /**
   * Фабричные методы для типовых ошибок
   */
  static badRequest(message: string, details?: unknown): Failure {
    return new Failure('BAD_REQUEST', message, details);
  }

  static unauthorized(message: string, details?: unknown): Failure {
    return new Failure('UNAUTHORIZED', message, details);
  }

  static forbidden(message: string, details?: unknown): Failure {
    return new Failure('FORBIDDEN', message, details);
  }

  static notFound(message: string, details?: unknown): Failure {
    return new Failure('NOT_FOUND', message, details);
  }

  static internalError(message: string, details?: unknown): Failure {
    return new Failure('INTERNAL_ERROR', message, details);
  }

  static notImplemented(message: string, details?: unknown): Failure {
    return new Failure('NOT_IMPLEMENTED', message, details);
  }

  static serviceUnavailable(message: string, details?: unknown): Failure {
    return new Failure('SERVICE_UNAVAILABLE', message, details);
  }

  static paymentRequired(message: string, details?: unknown): Failure {
    return new Failure('PAYMENT_REQUIRED', message, details);
  }
}
```

**Особенности:**
- Наследуется от Error (можно использовать throw/catch)
- Статус ошибки передается первым аргументом
- Опциональное поле `details` для дополнительной информации
- Правильный stack trace для отладки

### 4. Обработка в Pipeline

Pipeline автоматически преобразует результаты и ошибки в `ResponseContext`.

```typescript
// packages/nestling.pipeline/src/core/pipeline.ts

export class Pipeline {
  /**
   * Нормализует результат handler'а в ResponseContext
   * Поддерживает: Success, примитивы/объекты (автоматически -> Success.ok)
   * Ошибки обрабатываются только через throw Fail в errorToResponse()
   */
  private normalizeResponse<T>(
    result: Success<T> | T,
  ): ResponseContext<T> {
    // Если это Success - преобразуем в ResponseContext
    if (result instanceof Success) {
      return {
        status: result.status,
        value: result.value,
        headers: result.headers,
      };
    }

    // Иначе оборачиваем в Success.ok и преобразуем
    return {
      status: 'OK',
      value: result as T,
    };
  }

  /**
   * Преобразует ошибку в ResponseContext
   */
  private errorToResponse(error: unknown): ResponseContext {
    if (error instanceof Failure) {
      // Если это Failure - используем его статус и данные
      return {
        status: error.status,
        value: {
          error: error.message,
          ...(error.details && { details: error.details }),
        },
      };
    }

    // Для обычных ошибок - INTERNAL_ERROR
    // TODO: Переместить в конфигурацию
    const isDevelopment = true; // временная константа
    
    return {
      status: 'INTERNAL_ERROR',
      value: {
        error: isDevelopment 
          ? (error instanceof Error ? error.message : 'Unknown error')
          : 'Internal server error',
        ...(isDevelopment && error instanceof Error && { stack: error.stack }),
      },
    };
  }

  /**
   * Выполняет пайплайн: middleware → handler
   * Глобально перехватывает все ошибки
   */
  async executeWithHandler(
    handler: HandlerFn,
    ctx: RequestContext,
  ): Promise<ResponseContext> {
    try {
      let index = 0;

      const next = async (): Promise<ResponseContext> => {
        if (index < this.middlewares.length) {
          const middleware = this.middlewares[index++];
          return middleware(ctx, next);
        }

        if (!handler) {
          throw new Error('Handler is not set');
        }

        const result = await handler(ctx.payload as any, ctx.metadata as any);
        return this.normalizeResponse(result);
      };

      return await next();
    } catch (error) {
      // Глобальный перехват всех ошибок (из middleware или handler)
      return this.errorToResponse(error);
    }
  }
}
```

**Ключевые моменты:**
- `normalizeResponse()` — преобразует Success или обычные данные в ResponseContext (ошибки не обрабатываются здесь)
- `errorToResponse()` — преобразует Failure (из throw) или обычные ошибки в ResponseContext
- `try-catch` оборачивает весь пайплайн (middleware + handler)
- Все ошибки обрабатываются только через throw Fail, не через return

### 5. Обновленные типы

```typescript
// packages/nestling.pipeline/src/core/types/context.ts

/**
 * Абстрактный контекст ответа (используется внутри транспортов)
 */
export interface ResponseContext<TValue = unknown> {
  /** Статус ответа */
  status?: ProcessingStatus;

  /** HTTP заголовки (для HTTP transport) */
  headers?: Record<string, string>;

  /** Данные ответа (может быть AsyncIterableIterator для streaming) */
  value: TValue | null;
}

/**
 * Тип возвращаемого значения из handler'а
 * Handler может вернуть Success или выбросить Failure
 * Ошибки обрабатываются только через throw Fail, не через return
 */
export type Output<TValue = unknown> = Promise<Success<TValue> | TValue>;
```

```typescript
// packages/nestling.pipeline/src/core/types/endpoint.ts

/**
 * Функция-обработчик запроса
 * Ошибки обрабатываются только через throw Fail
 */
export type HandlerFn<TPayload = any, TMetadata = any, TOutput = any> = (
  payload: TPayload,
  metadata: TMetadata,
) => Promise<Success<TOutput> | TOutput>;
```

## Использование

### Базовый пример

```typescript
import { Endpoint, Success, Failure } from '@nestling/pipeline';
import type { Output } from '@nestling/pipeline';
import z from 'zod';

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
});

type User = z.infer<typeof UserSchema>;

@Endpoint({
  transport: 'http',
  pattern: 'GET /api/users/:id',
  input: z.object({ id: z.string() }),
  output: UserSchema,
})
export class GetUserEndpoint {
  async handle(payload: { id: string }): Output<User> {
    const user = await this.findUser(payload.id);
    
    if (!user) {
      throw Failure.notFound('User not found');
    }
    
    return WrappedSuccess.ok(user);
  }
}
```

### Варианты возврата результата

```typescript
// 1. Явный Success с OK статусом
return WrappedSuccess.ok({ id: 1, name: 'John' });

// 2. Success с другим статусом
return WrappedSuccess.created({ id: 1, name: 'John' });
return WrappedSuccess.accepted({ id: 1, name: 'John' });
return WrappedSuccess.noContent();

// 3. Success с заголовками
return WrappedSuccess.ok(
  { id: 1, name: 'John' },
  { 'X-Custom-Header': 'value' }
);

// 4. Автоматический WrappedSuccess.ok (просто возвращаем данные)
return { id: 1, name: 'John' };

// 5. Возврат null (если типизация output это разрешает)
return null; // → WrappedSuccess.ok(null)

// 6. Streaming response (для больших объемов данных)
async function* generateData() {
  yield { chunk: 1 };
  yield { chunk: 2 };
}
return WrappedSuccess.ok(generateData());
```

**Примечания:** 
- `null` и `undefined` валидны как результат, если схема `output` в декораторе `@Endpoint` это допускает. Они автоматически оборачиваются в `Success.ok(null)` или `Success.ok(undefined)`. При несоответствии типов TypeScript выдаст ошибку компиляции.
- Для streaming можно вернуть `AsyncIterableIterator` через `Success.ok()`. Транспортный слой обработает его соответствующим образом (например, HTTP transport будет отправлять данные по частям).

### Варианты обработки ошибок

```typescript
// 1. Фабричные методы Failure
throw Failure.badRequest('Invalid input');
throw Failure.unauthorized('Token expired');
throw Failure.forbidden('Access denied');
throw Failure.notFound('Resource not found');
throw Failure.internalError('Database error');

// 2. Failure с дополнительной информацией
throw Failure.badRequest('Validation failed', {
  fields: {
    email: 'Invalid email format',
    age: 'Must be 18 or older'
  }
});

// 3. Создание через конструктор
throw new Failure('BAD_REQUEST', 'Custom error message', { code: 'ERR_001' });
```

### Работа с middleware

Middleware также может бросать Failure:

```typescript
export const authMiddleware: MiddlewareFn = async (ctx, next) => {
  const token = ctx.metadata?.authorization;
  
  if (!token) {
    throw Failure.unauthorized('Authorization header required');
  }
  
  if (!isValidToken(token)) {
    throw Failure.unauthorized('Invalid token');
  }
  
  return next();
};
```

### Полный пример endpoint

```typescript
import { Endpoint, Success, Failure } from '@nestling/pipeline';
import type { Output } from '@nestling/pipeline';
import z from 'zod';

// Схемы
const GetUserByIdInput = z.object({
  id: z.string().transform(val => Number.parseInt(val, 10)),
});

const GetUserByIdMetadata = z.object({
  authorization: z.string().optional(),
});

const GetUserByIdOutput = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
});

type GetUserByIdInput = z.infer<typeof GetUserByIdInput>;
type GetUserByIdMetadata = z.infer<typeof GetUserByIdMetadata>;
type GetUserByIdOutput = z.infer<typeof GetUserByIdOutput>;

@Endpoint({
  transport: 'http',
  pattern: 'GET /api/users/:id',
  input: GetUserByIdInput,
  metadata: GetUserByIdMetadata,
  output: GetUserByIdOutput,
})
export class GetUserByIdEndpoint {
  async handle(
    payload: GetUserByIdInput,
    metadata: GetUserByIdMetadata,
  ): Output<GetUserByIdOutput> {
    // Проверка авторизации
    if (!metadata.authorization) {
      throw Failure.unauthorized('Authorization required');
    }

    // Валидация токена
    const isValid = await this.validateToken(metadata.authorization);
    if (!isValid) {
      throw Failure.unauthorized('Invalid or expired token');
    }

    // Проверка прав доступа
    const hasAccess = await this.checkAccess(payload.id);
    if (!hasAccess) {
      throw Failure.forbidden('You do not have access to this user');
    }

    // Получение данных
    const user = await this.userRepository.findById(payload.id);
    if (!user) {
      throw Failure.notFound(`User with id ${payload.id} not found`);
    }

    // Успешный ответ
    return WrappedSuccess.ok(user);
  }

  private async validateToken(token: string): Promise<boolean> {
    // Логика валидации токена
    return true;
  }

  private async checkAccess(userId: number): Promise<boolean> {
    // Логика проверки прав
    return true;
  }
}
```

## Поток данных

```
Handler возвращает:
  - Success<T> 
  - T (примитив/объект)
  - throws Failure
  - throws Error

           ↓

Pipeline.normalizeResponse():
  - Success<T> → ResponseContext { status, value, headers }
  - T → ResponseContext { status: 'OK', value: T }

           ↓

Pipeline.errorToResponse() (при исключении):
  - Failure → ResponseContext { status, value: { error, details } }
  - Error → ResponseContext { status: 'INTERNAL_ERROR', value: { error } }

           ↓

Transport (HttpTransport, CliTransport):
  - ResponseContext → нативный ответ (HTTP response, console output)
```

## Формат ответа ошибки

Когда бросается Failure, он преобразуется в ResponseContext со следующей структурой:

```json
{
  "error": "User not found",
  "details": {
    "userId": 123,
    "searchedIn": "database"
  }
}
```

Где:
- `error` — сообщение ошибки (message из Failure)
- `details` — опциональное поле с дополнительной информацией

## Миграция с старого кода

### Было (старый ResponseContext):

```typescript
async handle(payload, metadata): Promise<ResponseContext> {
  if (error) {
    return {
      status: 'NOT_FOUND',
      value: null,
    };
  }
  
  return {
    status: 'OK',
    value: data,
  };
}
```

### Стало (Success/Failure):

```typescript
async handle(payload, metadata): Output<DataType> {
  if (error) {
    throw Failure.notFound('Resource not found');
  }
  
  return WrappedSuccess.ok(data);
  // или просто: return data;
}
```

## Type Safety

TypeScript обеспечивает следующие гарантии:

1. **Success принимает только SuccessStatus**
   ```typescript
   WrappedSuccess.ok(data);       // ✅
   WrappedSuccess.created(data);  // ✅
   new Success('NOT_FOUND', data); // ❌ Ошибка компиляции
   ```

2. **Failure принимает только ErrorStatus**
   ```typescript
   Failure.notFound('error');           // ✅
   new Failure('INTERNAL_ERROR', 'msg'); // ✅
   new Failure('OK', 'msg');             // ❌ Ошибка компиляции
   ```

3. **Output<T> строго типизирован**
   ```typescript
   // Handler должен вернуть Success<User> или User
   async handle(): Output<User> {
     return WrappedSuccess.ok(user);  // ✅ user: User
     return user;              // ✅ user: User
     return WrappedSuccess.ok(123);   // ❌ number не User
   }
   ```

## Преимущества

1. **Явность** — Success/Failure четко разделяют успех и ошибку
2. **Type Safety** — TypeScript проверяет корректность использования
3. **Централизация** — вся обработка ошибок в одном месте (Pipeline)
4. **Удобство** — фабричные методы упрощают создание результатов
5. **Гибкость** — можно вернуть данные напрямую или явно Success
6. **Расширяемость** — легко добавить новые статусы или методы
7. **Отладка** — Failure сохраняет stack trace
8. **Separation of Concerns** — бизнес-логика не зависит от транспорта

## Расширение

### Добавление нового статуса успеха

```typescript
// 1. Добавить в status.ts
export const successStatuses = [
  'OK',
  'CREATED',
  'ACCEPTED',
  'NO_CONTENT',
  'PARTIAL_CONTENT', // новый статус
] as const;

// 2. Добавить фабричный метод в Success
static partialContent<T>(
  value: T,
  headers?: Record<string, string>
): Success<T> {
  return new Success('PARTIAL_CONTENT', value, headers);
}

// 3. Обновить маппинг в транспорте
const STATUS_MAP: Record<ProcessingStatus, number> = {
  // ...
  'PARTIAL_CONTENT': 206,
};
```

### Добавление нового статуса ошибки

```typescript
// 1. Добавить в status.ts
export const errorStatuses = [
  // ...
  'TOO_MANY_REQUESTS', // новый статус
] as const;

// 2. Добавить фабричный метод в Failure
static tooManyRequests(
  message: string,
  details?: unknown
): Failure {
  return new Failure('TOO_MANY_REQUESTS', message, details);
}

// 3. Обновить маппинг в транспорте
const STATUS_MAP: Record<ProcessingStatus, number> = {
  // ...
  'TOO_MANY_REQUESTS': 429,
};
```

## Тестирование

### Тестирование успешных кейсов

```typescript
import { Success, Failure } from '@nestling/pipeline';

describe('GetUserEndpoint', () => {
  it('should return user data', async () => {
    const endpoint = new GetUserEndpoint();
    const result = await endpoint.handle(
      { id: '1' },
      { authorization: 'Bearer token' }
    );

    expect(result).toBeInstanceOf(Success);
    expect(result.status).toBe('OK');
    expect(result.value).toEqual({
      id: 1,
      name: 'John',
      email: 'john@example.com'
    });
  });
});
```

### Тестирование ошибок

```typescript
describe('GetUserEndpoint', () => {
  it('should throw Failure when unauthorized', async () => {
    const endpoint = new GetUserEndpoint();
    
    await expect(
      endpoint.handle({ id: '1' }, {})
    ).rejects.toThrow(Failure);
    
    await expect(
      endpoint.handle({ id: '1' }, {})
    ).rejects.toMatchObject({
      status: 'UNAUTHORIZED',
      message: 'Authorization required'
    });
  });

  it('should throw Failure when user not found', async () => {
    const endpoint = new GetUserEndpoint();
    
    const error = await endpoint.handle(
      { id: '999' },
      { authorization: 'Bearer token' }
    ).catch(e => e);
    
    expect(error).toBeInstanceOf(Failure);
    expect(error.status).toBe('NOT_FOUND');
  });
});
```

### Тестирование Pipeline

```typescript
describe('Pipeline', () => {
  it('should convert Success to ResponseContext', async () => {
    const pipeline = new Pipeline();
    const handler = async () => WrappedSuccess.ok({ data: 'test' });
    
    const result = await pipeline.executeWithHandler(
      handler,
      mockContext
    );
    
    expect(result).toEqual({
      status: 'OK',
      value: { data: 'test' }
    });
  });

  it('should catch Failure and convert to ResponseContext', async () => {
    const pipeline = new Pipeline();
    const handler = async () => {
      throw Failure.notFound('Not found');
    };
    
    const result = await pipeline.executeWithHandler(
      handler,
      mockContext
    );
    
    expect(result).toEqual({
      status: 'NOT_FOUND',
      value: { error: 'Not found' }
    });
  });
});
```

## FAQ

### Q: Нужно ли всегда возвращать Success явно?

**A:** Нет. Можно просто вернуть данные, они автоматически обернутся в `Success.ok()`:

```typescript
// Оба варианта эквивалентны:
return WrappedSuccess.ok(user);
return user;
```

### Q: Что если я хочу вернуть другой статус?

**A:** Используйте явный Success с нужным статусом:

```typescript
return WrappedSuccess.created(newUser);
return WrappedSuccess.accepted(task);
return WrappedSuccess.noContent();
```

### Q: Можно ли обрабатывать ошибки в middleware?

**A:** Нет, middleware не должны использовать try-catch для перехвата ошибок из `next()`. Вся обработка ошибок централизована в Pipeline для обеспечения единообразия.

Для специальных случаев:
- **Логирование ошибок** — будет встроено в Pipeline
- **Трансформация ошибок** — планируется возможность регистрации кастомных преобразователей ошибок

Middleware может только генерировать собственные ошибки через `throw Failure.*()`.

### Q: Можно ли вернуть null или undefined из handler?

**A:** Да, если схема `output` в декораторе `@Endpoint` явно это разрешает:

```typescript
@Endpoint({
  transport: 'http',
  pattern: 'GET /api/user',
  output: z.object({ id: z.number() }).nullable(), // разрешаем null
})
export class GetUserEndpoint {
  async handle(): Output<User | null> {
    return null; // ✅ будет обернуто в WrappedSuccess.ok(null)
  }
}
```

Если схема не допускает `null`, а handler пытается вернуть его — TypeScript выдаст ошибку компиляции.

### Q: Как скрыть детали ошибок в production?

**A:** Для необработанных ошибок (не Failure) Pipeline различает dev/production режимы. В dev-режиме возвращается полное сообщение ошибки и stack trace, в production — только общее сообщение "Internal server error". 

В текущей реализации это временная константа `isDevelopment`, которая будет заменена на конфигурационный параметр.

Для ошибок типа Failure сообщения всегда возвращаются как есть, поскольку они явно создаются разработчиком для клиента.

### Q: Что если мне нужен кастомный формат ошибки?

**A:** Можно расширить метод `errorToResponse` в Pipeline или обработать ошибку на уровне транспорта.

### Q: Совместимо ли это с существующим кодом?

**A:** Нет, это breaking change. Все endpoints нужно обновить с `ResponseContext` на `Success`/`Failure`.

## Заключение

Новая архитектура Success/Failure обеспечивает:
- Явное разделение успешных результатов и ошибок
- Централизованную обработку ошибок
- Улучшенную type safety
- Более чистый и понятный API
- Лучшую расширяемость

Это фундаментальное улучшение, которое делает код более надежным и поддерживаемым.

