# Детальная реализация типизированного Pipeline (v2)

## Оглавление

1. [Архитектурная модель](#1-архитектурная-модель)
2. [Типизированный Context](#2-типизированный-context)
3. [Типизированные Middleware](#3-типизированные-middleware)
4. [Типизированный Pipeline](#4-типизированный-pipeline)
5. [Pipeline Builder API](#5-pipeline-builder-api)
6. [Интеграция с Endpoint](#6-интеграция-с-endpoint)
7. [Примеры использования](#7-примеры-использования)
8. [Интеграция с транспортами](#8-интеграция-с-транспортами)
9. [Преимущества архитектуры](#9-преимущества-архитектуры)
10. [План реализации](#10-план-реализации)

---

## 1. Архитектурная модель

### Ключевые принципы

```
Transport (raw request)
    ↓
Raw { transport, pattern, payload, attributes }
    ↓
UnvalidatedContext { raw, meta: {}, endpoint }
    ↓
Pipeline [Middleware₁ → ... → validate() → ... → Middlewareₙ]
    ↓
ValidatedContext { input, meta, endpoint }
    ↓
Endpoint.handle(input, meta)
    ↓
ResponseContext
```

### Правила

1. **Pipeline = типовой контракт** между транспортом и endpoint
2. **Metadata — продукт pipeline**, а не свойство endpoint
3. **input появляется ТОЛЬКО после валидации**
4. **До валидации есть только `raw.payload`**
5. **Endpoint получает только `input` и `meta`** (ничего больше!)
6. **Middleware могут читать `endpoint` metadata** для конфигурации
7. **Middleware ДО `validate()`** работают с `UnvalidatedContext` (доступ к `raw`)
8. **Middleware ПОСЛЕ `validate()`** работают с `ValidatedContext` (доступ к `input`, но не к `raw`)

---

## 2. Типизированный Context

### 2.1 Raw - нормализованные данные от транспорта

```typescript
/**
 * Данные от транспорта
 * Содержит нормализованные данные входа транспорта
 */
export interface Raw {
  /** Имя транспорта */
  transport: string; // 'http' | 'grpc' | 'cli' | ...

  /** Паттерн маршрута */
  pattern: string;

  /** Нормализованные входные данные */
  payload: unknown;

  /** Транспортные атрибуты (headers | grpc metadata | cli flags) */
  attributes: unknown;
}
```

**Важно:**
- `payload` — уже нормализованные данные (merge body+params+query для HTTP)
- `attributes` — транспортно-специфичные метаданные
- `Raw` доступен только middleware
- Handler никогда не видит `Raw`

### 2.2 UnvalidatedContext - до валидации

```typescript
/**
 * Контекст ДО валидации
 * 
 * ❗ input НЕ существует на этом этапе
 * ❗ Есть только raw.payload
 */
export interface UnvalidatedContext<TMeta = {}> {
  /** Данные от транспорта */
  readonly raw: Raw;

  /** Метаданные, накапливаемые middleware */
  meta: TMeta;

  /** Метаданные endpoint (readonly) */
  readonly endpoint: EndpointMetadata;
}
```

### 2.3 ValidatedContext - после валидации

```typescript
/**
 * Контекст ПОСЛЕ валидации
 * 
 * ✅ input появляется ТОЛЬКО здесь
 * ✅ input типизирован и провалидирован
 */
export interface ValidatedContext<TInput, TMeta> {
  /** Провалидированные входные данные */
  input: TInput;

  /** Метаданные, накапливаемые middleware */
  meta: TMeta;

  /** Метаданные endpoint (readonly) */
  readonly endpoint: EndpointMetadata;
}
```

### 2.4 Создание контекста транспортом

```typescript
/**
 * Transport создаёт Raw и UnvalidatedContext
 */
export function createUnvalidatedContext(
  raw: Raw,
  endpoint: EndpointMetadata,
): UnvalidatedContext<{}> {
  return {
    raw,
    meta: {},
    endpoint,
  };
}
```

**Примеры для разных транспортов:**

```typescript
// HTTP: Transport нормализует body + params + query
const raw: Raw = {
  transport: 'http',
  pattern: 'POST /users/:id',
  payload: {
    name: "Alice",
    id: "123",
    format: "json"
  },  // ← уже смержено!
  attributes: req.headers,
};

const ctx = createUnvalidatedContext(raw, endpointMetadata);
// ctx.raw.payload === { name: "Alice", id: "123", format: "json" }
// ctx.input === undefined (не существует до валидации!)

// gRPC: Transport декодирует protobuf
const raw: Raw = {
  transport: 'grpc',
  pattern: 'UserService/Create',
  payload: { name: "Alice", email: "alice@example.com" },
  attributes: grpcMetadata,
};

// CLI: Transport парсит argv
const raw: Raw = {
  transport: 'cli',
  pattern: 'create-user',
  payload: { name: "Alice", admin: true },
  attributes: { env: process.env, flags: parsedFlags },
};
```

---

## 3. Типизированные Middleware

### 3.1 Единый контракт middleware

```typescript
/**
 * Функция middleware
 * Преобразует контекст CIn → COut
 */
export type MiddlewareFn<CIn, COut> = (
  ctx: CIn,
  next: (ctx: COut) => Promise<ResponseContext>,
) => Promise<ResponseContext>;

/**
 * Интерфейс для классовых middleware
 */
export interface IMiddleware<CIn, COut> {
  handle(
    ctx: CIn,
    next: (ctx: COut) => Promise<ResponseContext>,
  ): Promise<ResponseContext>;
}

/**
 * Middleware может быть функцией или классом
 */
export type Middleware<CIn, COut> =
  | MiddlewareFn<CIn, COut>
  | IMiddleware<CIn, COut>;
```

**Важные правила:**

1. ✅ Middleware **могут** читать `ctx.raw` (до валидации)
2. ✅ Middleware **могут** читать `ctx.endpoint` для конфигурации
3. ✅ Middleware **могут** трансформировать `meta`
4. ✅ Middleware валидации создаёт `input` из `raw.payload`
5. ❌ Endpoint **никогда не видит** `raw` и `endpoint`
6. ❌ `input` нельзя модифицировать после валидации

### 3.2 Нормализация middleware

```typescript
/**
 * Приводит middleware к функциональной форме
 */
function normalizeMiddleware<CIn, COut>(
  mw: Middleware<CIn, COut>,
): MiddlewareFn<CIn, COut> {
  if (typeof mw === 'function') {
    return mw;
  }
  return mw.handle.bind(mw);
}
```

### 3.3 Middleware Builder Functions

#### Middleware валидации (ключевой!)

```typescript
/**
 * Валидирует raw.payload и создаёт input
 * 
 * ❗ Это единственный способ получить input
 * ❗ После этого middleware raw недоступен
 * 
 * Важно: validate() НЕ фиксирует конкретный TInput!
 * Тип input определяется:
 * - В runtime: схемой из endpoint.input
 * - В compile-time: типом IEndpoint<TInput, TMeta, TOutput>
 * 
 * Pipeline переиспользуем между endpoint'ами с разными input типами.
 * Декоратор @HttpEndpoint гарантирует соответствие схемы и типа.
 */
export function validate(): MiddlewareFn<
  UnvalidatedContext<any>,
  ValidatedContext<unknown, any>
> {
  return async (ctx, next) => {
    // Получаем схему из endpoint metadata
    const schema = ctx.endpoint.input;
    if (!schema) {
      throw new Error('Input schema not defined in endpoint');
    }

    // Валидируем raw.payload
    const input = schema.parse(ctx.raw.payload);

    // Создаём ValidatedContext с input
    // raw больше не передаётся — он недоступен после валидации
    return next({
      input,
      meta: ctx.meta,
      endpoint: ctx.endpoint,
    });
  };
}
```

#### Middleware для добавления identity

```typescript
/**
 * Добавляет identity в metadata
 * 
 * Читает raw.attributes для извлечения токена/сессии
 */
export function withIdentity<TUser>(
  authenticate: (raw: Raw) => Promise<TUser>,
): MiddlewareFn<
  UnvalidatedContext<any>,
  UnvalidatedContext<any & { identity: TUser }>
> {
  return async (ctx, next) => {
    const identity = await authenticate(ctx.raw);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        identity,
      },
    });
  };
}

/**
 * Примеры использования:
 */

// HTTP
const httpAuth = withIdentity<User>(async (raw) => {
  const headers = raw.attributes as Record<string, string>;
  const token = headers['authorization'];
  return await verifyJWT(token);
});

// gRPC
const grpcAuth = withIdentity<User>(async (raw) => {
  const metadata = raw.attributes as GrpcMetadata;
  const token = metadata.get('authorization')[0];
  return await verifyJWT(token);
});
```

#### Middleware для permissions (после identity)

```typescript
/**
 * Добавляет permissions в metadata
 * Требует, чтобы identity уже была в meta
 */
export function withPermissions<TPermissions>(
  getPermissions: (identity: any) => Promise<TPermissions>,
): MiddlewareFn<
  UnvalidatedContext<{ identity: any }>,
  UnvalidatedContext<{ identity: any; permissions: TPermissions }>
> {
  return async (ctx, next) => {
    const permissions = await getPermissions(ctx.meta.identity);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        permissions,
      },
    });
  };
}
```

#### Middleware для добавления произвольного поля в meta

```typescript
/**
 * Добавляет произвольное поле в metadata
 */
export function withMeta<TKey extends string, TValue>(
  key: TKey,
  getValue: (ctx: UnvalidatedContext<any>) => Promise<TValue> | TValue,
): MiddlewareFn<
  UnvalidatedContext<any>,
  UnvalidatedContext<any & Record<TKey, TValue>>
> {
  return async (ctx, next) => {
    const value = await getValue(ctx);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        [key]: value,
      },
    });
  };
}
```

#### Timing middleware

```typescript
/**
 * Измеряет время выполнения
 */
export function withTiming(): MiddlewareFn<any, any> {
  return async (ctx, next) => {
    const start = Date.now();
    const response = await next(ctx);
    const duration = Date.now() - start;

    if (!response.headers) {
      response.headers = {};
    }
    response.headers['X-Response-Time'] = `${duration}ms`;

    return response;
  };
}
```

#### Logging middleware

```typescript
/**
 * Логирует запросы
 */
export function withLogging(
  logger: { log: (msg: string) => void },
): MiddlewareFn<UnvalidatedContext<any>, UnvalidatedContext<any>> {
  return async (ctx, next) => {
    logger.log(`[${ctx.raw.transport}] ${ctx.raw.pattern} - started`);
    const response = await next(ctx);
    logger.log(`[${ctx.raw.transport}] ${ctx.raw.pattern} - completed`);
    return response;
  };
}
```

#### Middleware на основе endpoint metadata

```typescript
/**
 * Rate limiting на основе endpoint metadata
 */
export function withRateLimit(
  limiter: RateLimiter,
): MiddlewareFn<UnvalidatedContext<any>, UnvalidatedContext<any>> {
  return async (ctx, next) => {
    // Читаем конфигурацию из endpoint metadata
    const config = ctx.endpoint.rateLimit;
    
    if (config) {
      await limiter.check(ctx.raw.attributes, config);
    }

    return next(ctx);
  };
}

/**
 * Audit logging на основе endpoint metadata
 * 
 * ❗ Работает ПОСЛЕ validate() — получает ValidatedContext
 * ❗ Имеет доступ к ctx.input (уже провалидирован)
 */
export function withAudit(
  auditService: AuditService,
): MiddlewareFn<ValidatedContext<any, any>, ValidatedContext<any, any>> {
  return async (ctx, next) => {
    // Проверяем, нужен ли аудит
    if (ctx.endpoint.audit) {
      await auditService.log({
        endpoint: ctx.endpoint.pattern,
        input: ctx.input,  // ← input доступен после validate()
        identity: ctx.meta.identity,
      });
    }

    return next(ctx);
  };
}

/**
 * Добавляет поле в meta ПОСЛЕ валидации
 * 
 * Пример: загрузка связанной сущности по ID из input
 */
export function withEntity<TKey extends string, TEntity>(
  key: TKey,
  loadEntity: (input: any) => Promise<TEntity>,
): MiddlewareFn<
  ValidatedContext<any, any>,
  ValidatedContext<any, any & Record<TKey, TEntity>>
> {
  return async (ctx, next) => {
    const entity = await loadEntity(ctx.input);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        [key]: entity,
      },
    });
  };
}
```

### 3.4 Классовые middleware

```typescript
/**
 * Пример классового middleware с DI
 */
@Injectable([AuthService])
class AuthMiddleware implements IMiddleware<
  UnvalidatedContext<any>,
  UnvalidatedContext<any & { identity: User }>
> {
  constructor(private auth: AuthService) {}

  async handle(ctx, next) {
    const identity = await this.auth.verifyFromRaw(ctx.raw);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        identity,
      },
    });
  }
}

/**
 * Использование:
 */
const pipeline = definePipeline()
  .use(new AuthMiddleware(authService))    // до validate — UnvalidatedContext
  .use(withPermissions(loadPermissions))   // до validate — UnvalidatedContext  
  .use(validate())                         // переход → ValidatedContext
  .use(withAudit(auditService));           // после validate — ValidatedContext
```

---

## 4. Типизированный Pipeline

### 4.1 TypedPipeline

```typescript
/**
 * Типизированный pipeline
 * 
 * CIn  - входной тип контекста (UnvalidatedContext<{}>)
 * COut - выходной тип контекста (ValidatedContext<I, M>)
 */
export class TypedPipeline<CIn, COut> {
  private readonly middlewares: MiddlewareFn<any, any>[] = [];

  /**
   * Приватный конструктор - создание только через builder
   */
  private constructor(middlewares: MiddlewareFn<any, any>[]) {
    this.middlewares = middlewares;
  }

  /**
   * Создаёт пустой pipeline
   */
  static empty(): TypedPipeline<UnvalidatedContext<{}>, UnvalidatedContext<{}>> {
    return new TypedPipeline([]);
  }

  /**
   * Добавляет middleware в конец цепочки
   */
  use<CNext>(
    middleware: Middleware<COut, CNext>,
  ): TypedPipeline<CIn, CNext> {
    return new TypedPipeline([
      ...this.middlewares,
      normalizeMiddleware(middleware),
    ]);
  }

  /**
   * Выполняет pipeline с handler
   * 
   * @param handler - бизнес-логика endpoint (получает только input и meta)
   * @param ctx - начальный контекст от транспорта
   */
  async executeWithHandler<TOutput>(
    handler: (input: any, meta: any) => OutputSync<TOutput> | Output<TOutput>,
    ctx: CIn,
  ): Promise<ResponseContext<TOutput>> {
    try {
      let currentCtx: any = ctx;

      // Выполняем цепочку middleware
      for (const middleware of this.middlewares) {
        let nextCalled = false;
        let nextCtx: any;

        const response = await middleware(currentCtx, async (newCtx) => {
          nextCalled = true;
          nextCtx = newCtx;
          return null as any;
        });

        // Если middleware вернул response напрямую
        if (!nextCalled) {
          return response;
        }

        currentCtx = nextCtx;
      }

      // Вызываем handler только с input и meta
      // Handler НЕ получает raw и endpoint!
      const result = await handler(currentCtx.input, currentCtx.meta);
      return this.normalizeResponse(result);
    } catch (error) {
      return this.errorToResponse(error);
    }
  }

  private normalizeResponse<T>(result: OutputSync<T>): ResponseContext<T> {
    if (result instanceof Ok) {
      return {
        isSuccess: true,
        ...result,
      };
    }

    return {
      isSuccess: true,
      status: 'OK',
      value: result as T,
    };
  }

  private errorToResponse(error: unknown): ResponseContext {
    if (error instanceof Fail) {
      const errorValue: ErrorDetails = {
        error: error.message,
      };
      if (error.details) {
        errorValue.details = error.details;
      }
      return {
        isSuccess: false,
        status: error.status,
        value: errorValue,
      };
    }

    const isDevelopment = true;
    const errorValue: ErrorDetails = {
      error: isDevelopment
        ? error instanceof Error
          ? error.message
          : 'Unknown error'
        : 'Internal server error',
    };

    if (isDevelopment && error instanceof Error && error.stack) {
      errorValue.stack = error.stack;
    }

    return {
      isSuccess: false,
      status: 'INTERNAL_ERROR',
      value: errorValue,
    };
  }
}

/**
 * ResponseContext - результат выполнения pipeline
 */
export interface ResponseContext<T = unknown> {
  /** Успешность операции */
  isSuccess: boolean;

  /** Статус (OK, CREATED, BAD_REQUEST, NOT_FOUND, INTERNAL_ERROR, ...) */
  status: string;

  /** Результат или ошибка */
  value: T;

  /** HTTP headers для ответа (опционально) */
  headers?: Record<string, string>;
}

/**
 * Детали ошибки
 */
export interface ErrorDetails {
  error: string;
  details?: unknown;
  stack?: string;
}

/**
 * Type helpers
 */

/** Извлекает TMeta из pipeline */
export type InferPipelineMeta<P> =
  P extends TypedPipeline<any, ValidatedContext<any, infer M>> ? M :
  P extends TypedPipeline<any, UnvalidatedContext<infer M>> ? M :
  never;

/** Проверяет, содержит ли pipeline validate() */
export type HasValidation<P> =
  P extends TypedPipeline<any, ValidatedContext<any, any>> ? true : false;
```

---

## 5. Pipeline Builder API

### 5.1 Fluent Builder

```typescript
/**
 * Создаёт пустой pipeline
 */
export function definePipeline() {
  return TypedPipeline.empty();
}
```

### 5.2 Типичный pipeline

```typescript
/**
 * Пример: pipeline с auth и валидацией
 * 
 * validate() НЕ принимает типовой параметр!
 * Тип input определяется endpoint'ом, а не pipeline'ом.
 * Это позволяет переиспользовать один pipeline между разными endpoint'ами.
 */
const authPipeline = definePipeline()
  .use(withTiming())
  .use(withLogging(logger))
  .use(withIdentity<User>(async (raw) => {
    const headers = raw.attributes as Record<string, string>;
    return await verifyJWT(headers['authorization']);
  }))
  .use(withPermissions<Permission[]>(async (identity) => {
    return await loadPermissions(identity.id);
  }))
  .use(validate());

// Тип authPipeline:
// TypedPipeline<
//   UnvalidatedContext<{}>,
//   ValidatedContext<unknown, { identity: User; permissions: Permission[] }>
// >
// 
// TInput = unknown, потому что pipeline не знает конкретный тип.
// Декоратор @HttpEndpoint сопоставляет pipeline output с IEndpoint<TInput, TMeta, TOutput>.
```

### 5.3 Переиспользуемые композиции

```typescript
/**
 * Базовый HTTP pipeline
 */
export function baseHttpPipeline(logger: Logger) {
  return definePipeline()
    .use(withTiming())
    .use(withLogging(logger));
}

/**
 * Pipeline с сессионной авторизацией
 */
export function withSessionAuth(authService: AuthService) {
  return baseHttpPipeline(logger)
    .use(withIdentity<User>(async (raw) => {
      const headers = raw.attributes as Record<string, string>;
      const sessionId = headers['cookie'];
      return await authService.verifySession(sessionId);
    }));
}

/**
 * Pipeline с API key авторизацией
 */
export function withApiKeyAuth(authService: AuthService) {
  return baseHttpPipeline(logger)
    .use(withIdentity<ApiClient>(async (raw) => {
      const headers = raw.attributes as Record<string, string>;
      const apiKey = headers['x-api-key'];
      return await authService.verifyApiKey(apiKey);
    }));
}
```

---

## 6. Интеграция с Endpoint

### 6.1 Обновлённый IEndpoint

```typescript
/**
 * Интерфейс endpoint
 * 
 * Handler получает ТОЛЬКО input и meta
 * Никакого raw, никакого endpoint metadata!
 */
export interface IEndpoint<TInput, TMeta, TOutput> {
  handle(input: TInput, meta: TMeta): OutputSync<TOutput> | Output<TOutput>;
}
```

### 6.2 EndpointMetadata

```typescript
/**
 * Метаданные endpoint
 * Доступны middleware для конфигурации
 */
export interface EndpointMetadata<TInput = any, TOutput = any> {
  transport: string;
  pattern: string;

  /** Schema для валидации input */
  input?: ZodSchema<TInput>;

  /** Schema для output (опционально) */
  output?: ZodSchema<TOutput> | OutputModifier<TOutput>;

  /** Pipeline для этого endpoint */
  pipeline: TypedPipeline<any, any>;

  /** Дополнительные опции для middleware */
  rateLimit?: RateLimitConfig;
  audit?: boolean;
  cache?: CacheConfig;
  // ... другие опции
}
```

### 6.3 HttpEndpoint декоратор (рекомендуемый подход)

```typescript
/**
 * Допустимый выход pipeline:
 * - ValidatedContext<unknown, TMeta> — после validate() (TInput определяется схемой)
 * - UnvalidatedContext<TMeta> — без validate() (TInput = {})
 */
type ValidPipelineOutput<TInput, TMeta> =
  | ValidatedContext<unknown, TMeta>  // validate() возвращает unknown
  | (TInput extends Record<string, never> ? UnvalidatedContext<TMeta> : never);

/**
 * HttpEndpoint с pipeline
 * 
 * Pipeline - часть metadata endpoint'а (не отдельный декоратор!)
 * 
 * ✅ Compile-time защита:
 * - Если TInput = {}, допускается pipeline без validate()
 * - Если TInput ≠ {}, требуется input schema + pipeline с validate()
 * - TMeta из pipeline должен соответствовать TMeta endpoint'а
 * 
 * TInput определяется схемой (ZodSchema<TInput>), НЕ pipeline'ом.
 * Pipeline переиспользуем между endpoint'ами с разными TInput.
 */
export function HttpEndpoint<TInput, TMeta, TOutput>(
  method: Router.HTTPMethod,
  path: string,
  options: {
    /** Schema определяет TInput (compile-time и runtime) */
    input?: ZodSchema<TInput>;
    output?: ZodSchema<TOutput> | OutputModifier<TOutput>;
    /** Pipeline должен содержать validate() если input задан */
    pipeline: TypedPipeline<
      UnvalidatedContext<{}>,
      ValidPipelineOutput<TInput, TMeta>
    >;
    rateLimit?: RateLimitConfig;
    audit?: boolean;
  },
) {
  return <
    T extends new (...args: any[]) => IEndpoint<TInput, TMeta, TOutput>,
  >(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем метаданные
    (target as any)[HANDLER_KEY] = {
      transport: 'http',
      pattern: `${method} ${path}`,
      input: options.input,
      output: options.output,
      pipeline: options.pipeline,
      rateLimit: options.rateLimit,
      audit: options.audit,
      className: context.name,
    };

    registerEndpoint(target as Constructor<IEndpoint>);

    return target;
  };
}

const HANDLER_KEY = Symbol.for('nestling:handler');
```

**Compile-time защита гарантирует:**

```typescript
// ✅ OK: pipeline с validate(), schema определяет TInput
const pipeline = definePipeline().use(validate());

@HttpEndpoint('POST', '/users', { 
  pipeline, 
  input: CreateUserSchema,  // ← TInput = z.infer<typeof CreateUserSchema>
})
class CreateUser implements IEndpoint<CreateUserInput, {}, User> { ... }

// ✅ OK: pipeline без validate(), TInput = {}
const simplePipeline = definePipeline().use(withLogging(logger));

@HttpEndpoint('GET', '/health', { pipeline: simplePipeline })
class HealthCheck implements IEndpoint<{}, {}, { status: string }> { ... }

// ❌ TS Error: pipeline без validate(), но endpoint ожидает TInput
const brokenPipeline = definePipeline().use(withLogging(logger));

@HttpEndpoint('POST', '/users', { 
  pipeline: brokenPipeline,  // ❌ нет validate()
  input: CreateUserSchema,
})
class CreateUser implements IEndpoint<CreateUserInput, {}, User> { ... }
// Error: UnvalidatedContext<{}> не совместим с ValidatedContext<unknown, {}>
```

**Переиспользуемость pipeline:**

```typescript
// Один pipeline — разные endpoint'ы с разными TInput
const authPipeline = definePipeline()
  .use(withIdentity<User>(verifyToken))
  .use(validate());

@HttpEndpoint('POST', '/users', { pipeline: authPipeline, input: CreateUserSchema })
class CreateUser implements IEndpoint<CreateUserInput, { identity: User }, User> { ... }

@HttpEndpoint('PUT', '/users/:id', { pipeline: authPipeline, input: UpdateUserSchema })
class UpdateUser implements IEndpoint<UpdateUserInput, { identity: User }, User> { ... }

@HttpEndpoint('DELETE', '/users/:id', { pipeline: authPipeline, input: DeleteUserSchema })
class DeleteUser implements IEndpoint<DeleteUserInput, { identity: User }, void> { ... }
```
```

---

## 7. Примеры использования

### 7.1 Простой endpoint

```typescript
const simplePipeline = definePipeline()
  .use(validate());

@Injectable([UserService, ILogger])
@HttpEndpoint('POST', '/api/users', {
  input: CreateUserSchema,
  output: CreateUserOutput,
  pipeline: simplePipeline,
})
export class CreateUserEndpoint implements IEndpoint<
  CreateUserInput,
  {},  // meta пустая
  CreateUserOutput
> {
  constructor(
    private users: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(input: CreateUserInput, meta: {}): Output<CreateUserOutput> {
    // input уже провалидирован!
    // meta пустая
    // raw и endpoint НЕ доступны!
    
    const user = await this.users.create(input);
    return Ok.created(user);
  }
}
```

### 7.2 Endpoint с авторизацией

```typescript
// Переиспользуем authPipeline из примера 5.2
// authPipeline уже содержит withIdentity, withPermissions и validate()

@Injectable([UserService])
@HttpEndpoint('PUT', '/api/users/:id', {
  input: UpdateUserSchema,  // ← определяет TInput = UpdateUserInput
  output: UpdateUserOutput,
  pipeline: authPipeline,   // ← переиспользуем pipeline!
  audit: true,              // ← middleware прочитает это
})
export class UpdateUserEndpoint implements IEndpoint<
  UpdateUserInput,
  { identity: User; permissions: Permission[] },
  UpdateUserOutput
> {
  constructor(private users: UserService) {}

  async handle(
    input: UpdateUserInput,
    meta: { identity: User; permissions: Permission[] },
  ): Output<UpdateUserOutput> {
    // input провалидирован
    // meta.identity и meta.permissions гарантированы pipeline
    
    if (!meta.permissions.includes('users:write')) {
      throw Fail.forbidden('No permission to update users');
    }

    const user = await this.users.update(input.id, input);
    return Ok.ok(user);
  }
}
```

### 7.3 Разные pipelines для одной бизнес-операции

```typescript
// Общий сервис
@Injectable()
class UserService {
  async createUser(data: CreateUserInput): Promise<User> { ... }
}

// Pipeline для внутреннего API (сессия)
const internalPipeline = definePipeline()
  .use(withIdentity<User>(verifySession))
  .use(validate());

// Pipeline для внешнего API (API key)
const externalPipeline = definePipeline()
  .use(withIdentity<ApiClient>(verifyApiKey))
  .use(validate());

// Endpoint для фронтенда
@Injectable([UserService])
@HttpEndpoint('POST', '/internal/users', {
  input: CreateUserSchema,
  pipeline: internalPipeline,
})
export class CreateUserForFrontend implements IEndpoint<
  CreateUserInput,
  { identity: User },
  CreateUserOutput
> {
  constructor(private users: UserService) {}

  async handle(input: CreateUserInput, meta: { identity: User }) {
    // meta.identity гарантированно User
    return Ok.created(await this.users.createUser(input));
  }
}

// Endpoint для внешнего API
@Injectable([UserService])
@HttpEndpoint('POST', '/api/v1/users', {
  input: CreateUserSchema,
  pipeline: externalPipeline,
})
export class CreateUserForAPI implements IEndpoint<
  CreateUserInput,
  { identity: ApiClient },
  CreateUserOutput
> {
  constructor(private users: UserService) {}

  async handle(input: CreateUserInput, meta: { identity: ApiClient }) {
    // meta.identity гарантированно ApiClient
    return Ok.created(await this.users.createUser(input));
  }
}
```

### 7.4 Middleware после validate()

```typescript
/**
 * Pipeline с middleware ДО и ПОСЛЕ валидации
 * 
 * Порядок:
 * 1. withIdentity() — до validate, читает raw.attributes
 * 2. validate() — создаёт input из raw.payload
 * 3. withEntity() — после validate, использует input для загрузки сущности
 * 4. withAudit() — после validate, логирует input
 */
const fullPipeline = definePipeline()
  // ДО validate() — UnvalidatedContext
  .use(withTiming())
  .use(withIdentity<User>(async (raw) => {
    const headers = raw.attributes as Record<string, string>;
    return await verifyToken(headers['authorization']);
  }))
  // validate() — переход UnvalidatedContext → ValidatedContext
  .use(validate())
  // ПОСЛЕ validate() — ValidatedContext
  .use(withEntity('article', async (input) => {
    // input.id уже провалидирован!
    return await articleRepo.findById(input.id);
  }))
  .use(withAudit(auditService));

// Тип fullPipeline:
// TypedPipeline<
//   UnvalidatedContext<{}>,
//   ValidatedContext<unknown, { identity: User; article: Article }>
// >
// 
// TInput = unknown — конкретный тип определяется endpoint'ом

@Injectable([ArticleService])
@HttpEndpoint('PUT', '/api/articles/:id', {
  input: UpdateArticleSchema,
  pipeline: fullPipeline,
  audit: true,
})
export class UpdateArticleEndpoint implements IEndpoint<
  UpdateArticleInput,
  { identity: User; article: Article },
  ArticleOutput
> {
  constructor(private articles: ArticleService) {}

  async handle(
    input: UpdateArticleInput,
    meta: { identity: User; article: Article },
  ): Output<ArticleOutput> {
    // input провалидирован
    // meta.identity — текущий пользователь
    // meta.article — загруженная сущность (middleware withEntity)
    
    // Проверяем владельца
    if (meta.article.authorId !== meta.identity.id) {
      throw Fail.forbidden('Not the author');
    }

    const updated = await this.articles.update(meta.article, input);
    return Ok.ok(updated);
  }
}
```

**Правило:** middleware ДО `validate()` работают с `UnvalidatedContext` и имеют доступ к `raw`. Middleware ПОСЛЕ `validate()` работают с `ValidatedContext` и имеют доступ к `input`, но НЕ к `raw`.

### 7.5 Endpoint без валидации (пустой input)

```typescript
/**
 * Pipeline БЕЗ validate() — для endpoint'ов без входных данных
 */
const healthPipeline = definePipeline()
  .use(withTiming());

// Тип: TypedPipeline<UnvalidatedContext<{}>, UnvalidatedContext<{}>>

@HttpEndpoint('GET', '/health', {
  pipeline: healthPipeline,
})
export class HealthCheckEndpoint implements IEndpoint<{}, {}, { status: string }> {
  async handle(input: {}, meta: {}): OutputSync<{ status: string }> {
    return { status: 'ok' };
  }
}

/**
 * С авторизацией, но без input
 */
const authedHealthPipeline = definePipeline()
  .use(withIdentity<User>(verifyToken));

// Тип: TypedPipeline<UnvalidatedContext<{}>, UnvalidatedContext<{ identity: User }>>

@HttpEndpoint('GET', '/api/whoami', {
  pipeline: authedHealthPipeline,
})
export class WhoAmIEndpoint implements IEndpoint<{}, { identity: User }, User> {
  async handle(input: {}, meta: { identity: User }): OutputSync<User> {
    return meta.identity;
  }
}
```

### 7.6 Streaming endpoint

```typescript
const streamPipeline = definePipeline()
  .use(withIdentity<User>(verifySession))
  .use(validate());

@Injectable([UserService])
@HttpEndpoint('GET', '/api/users/export', {
  input: ExportFiltersSchema,
  output: stream(ExportUserOutput),
  pipeline: streamPipeline,
})
export class ExportUsersEndpoint implements IEndpoint<
  ExportFilters,
  { identity: User },
  AsyncIterableIterator<User>
> {
  constructor(private users: UserService) {}

  async handle(input: ExportFilters, meta: { identity: User }) {
    const stream = this.users.exportAll(input.filters);
    return new Ok(stream, {
      'Content-Type': 'application/x-ndjson',
    });
  }
}
```

---

## 8. Интеграция с транспортами

### 8.1 HttpTransport

```typescript
private async handle(nativeReq: IncomingMessage, nativeRes: ServerResponse) {
  // 1. Находим маршрут
  const route = this.router.find(nativeReq);
  if (!route) {
    nativeRes.statusCode = 404;
    nativeRes.end('Not Found');
    return;
  }

  // 2. Парсим и нормализуем данные
  const url = new URL(nativeReq.url || '/', `http://${nativeReq.headers.host}`);
  const query = Object.fromEntries(url.searchParams.entries());
  const body = await this.parseBody(nativeReq);
  const normalizedPayload = this.mergePayload(body, query, route.params);

  // 3. Создаём Raw
  const raw: Raw = {
    transport: 'http',
    pattern: `${nativeReq.method} ${url.pathname}`,
    payload: normalizedPayload,
    attributes: nativeReq.headers as Record<string, string>,
  };

  // 4. Создаём UnvalidatedContext
  const ctx = createUnvalidatedContext(raw, route.metadata);

  // 5. Получаем pipeline из endpoint metadata
  const pipeline = route.metadata.pipeline;

  // 6. Выполняем pipeline → handler
  // Handler получит только input и meta!
  const responseContext = await pipeline.executeWithHandler(
    route.handler,
    ctx,
  );

  // 7. Отправляем ответ
  sendResponse(nativeRes, responseContext);
}
```

### 8.2 Роль транспорта

**Transport отвечает за:**
- ✅ Парсинг сырых данных (body, headers, query, params)
- ✅ Нормализация payload
- ✅ Создание `Raw`
- ✅ Создание `UnvalidatedContext`
- ✅ Выполнение pipeline
- ✅ Отправка ответа

**Transport НЕ отвечает за:**
- ❌ Валидацию payload (делает middleware `validate()`)
- ❌ Типизацию meta (делает middleware)
- ❌ Авторизацию (делает middleware)
- ❌ Бизнес-логику (делает endpoint)

### 8.3 Примеры для других транспортов

**gRPC Transport:**

```typescript
const raw: Raw = {
  transport: 'grpc',
  pattern: 'UserService/CreateUser',
  payload: decodedMessage,
  attributes: call.metadata,
};

const ctx = createUnvalidatedContext(raw, endpointMetadata);
```

**CLI Transport:**

```typescript
const raw: Raw = {
  transport: 'cli',
  pattern: 'create-user',
  payload: parsedArgs,
  attributes: { env: process.env, flags: extractedFlags },
};

const ctx = createUnvalidatedContext(raw, endpointMetadata);
```

---

## 9. Преимущества архитектуры

### ✅ Чёткая фазность

```
raw.payload (unknown)
    ↓ validate()
input (typed, immutable)
```

- `input` появляется ТОЛЬКО после валидации
- Невозможно использовать input до валидации
- Невозможно модифицировать input после валидации

### ✅ Handler максимально чистый

```typescript
async handle(input: TInput, meta: TMeta) {
  // Только бизнес-данные!
  // Нет raw, нет endpoint, нет transport
}
```

### ✅ Middleware могут конфигурироваться через endpoint

```typescript
// В декораторе
@HttpEndpoint(..., {
  rateLimit: 'user',
  audit: true,
  cache: { ttl: 60 },
})

// В middleware
if (ctx.endpoint.audit) { ... }
```

### ✅ Pipeline переиспользуем

- Один pipeline — много endpoint'ов
- Schema берётся из endpoint metadata
- Middleware не знают конкретные схемы

### ✅ Типобезопасность

- Compile-time проверка совместимости pipeline и endpoint
- TypeScript знает, что есть в meta после каждого middleware
- IDE autocomplete работает идеально

### ✅ Transport-agnostic

- Pipeline работает с абстрактным Raw
- Middleware сами интерпретируют attributes
- HTTP, gRPC, CLI, Message Queue — без изменений

---

## 10. План реализации

### Фаза 1: Ядро типизации

1. `Raw`, `UnvalidatedContext`, `ValidatedContext`
2. `MiddlewareFn`, `IMiddleware`, `Middleware`
3. `TypedPipeline` с методами `use()` и `executeWithHandler()`
4. `definePipeline()`

### Фаза 2: Базовые middleware

5. `validate()` - валидация и создание input
6. `withTiming()`, `withLogging()`
7. `withIdentity()`, `withPermissions()`, `withMeta()`

### Фаза 3: Интеграция

8. Обновление `IEndpoint<I, M, O>`
9. Обновление `EndpointMetadata`
10. Обновление `HttpEndpoint()` декоратора
11. Обновление `HttpTransport`

### Фаза 4: Примеры

12. Простой endpoint
13. Endpoint с auth
14. Разные pipelines
15. Streaming

---

## 11. Итоговая архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                        Transport                            │
│  (HTTP, gRPC, CLI, Message Queue, ...)                     │
│                                                             │
│  1. Парсит сырой request                                   │
│  2. Нормализует payload                                    │
│  3. Создаёт Raw { transport, pattern, payload, attributes }│
│  4. Создаёт UnvalidatedContext { raw, meta: {}, endpoint } │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               TypedPipeline<CIn, COut>                      │
│                                                             │
│  ┌─ UnvalidatedContext { raw, meta, endpoint } ───────────┐│
│  │  ↓ withTiming()                                        ││
│  │  ↓ withLogging()       ← могут читать ctx.raw          ││
│  │  ↓ withIdentity()      → meta.identity                 ││
│  │  ↓ withPermissions()   → meta.permissions              ││
│  └────────────────────────────────────────────────────────┘│
│                         │                                   │
│                         ▼ validate()                        │
│                                                             │
│  ┌─ ValidatedContext { input, meta, endpoint } ───────────┐│
│  │  ↓ withEntity()        ← может читать ctx.input        ││
│  │  ↓ withAudit()         → логирует input                ││
│  └────────────────────────────────────────────────────────┘│
│                                                             │
│  • Middleware ДО validate() работают с raw                 │
│  • Middleware ПОСЛЕ validate() работают с input            │
│  • validate() — точка перехода                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            Endpoint.handle(input, meta)                     │
│                                                             │
│  • Получает ТОЛЬКО input и meta                            │
│  • raw НЕДОСТУПЕН                                          │
│  • endpoint metadata НЕДОСТУПНА                            │
│  • Чистая бизнес-логика                                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    ResponseContext                          │
│  { isSuccess, status, value, headers }                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Заключение

Архитектура v2 решает все проблемы из предыдущих обсуждений:

✅ **input появляется ТОЛЬКО после валидации**
- До валидации есть только `raw.payload`
- После валидации input immutable

✅ **Handler максимально чистый**
- Только `(input, meta)` — ничего больше
- Не видит raw, endpoint, transport

✅ **Middleware могут конфигурироваться через endpoint**
- Читают `ctx.endpoint` для rate limit, audit, cache и т.д.
- Pipeline переиспользуем

✅ **Pipeline полностью переиспользуем**
- `validate()` не фиксирует TInput — он определяется endpoint'ом
- Один pipeline → много endpoint'ов с разными input схемами
- Schema в декораторе определяет и runtime-валидацию, и compile-time тип

✅ **Middleware ДО и ПОСЛЕ validate()**
- ДО: `UnvalidatedContext` — доступ к `raw`, нет `input`
- ПОСЛЕ: `ValidatedContext` — доступ к `input`, нет `raw`
- `validate()` — точка перехода между фазами

✅ **Pipeline в декораторе endpoint'а**
- Не отдельный `@UsePipeline`
- Pipeline = часть контракта endpoint ↔ transport

✅ **Middleware как функции и классы**
- Обе формы поддерживаются
- Pipeline нормализует к функциям

✅ **Типобезопасность**
- Compile-time проверка pipeline ↔ endpoint
- TypeScript знает состояние meta после каждого middleware
- Декоратор гарантирует соответствие schema и IEndpoint

Это зрелая, минималистичная архитектура, готовая к реализации.
