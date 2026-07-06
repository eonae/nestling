# Детальная реализация типизированного Pipeline

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
10. [Потенциальные проблемы и решения](#10-потенциальные-проблемы-и-решения)
11. [Итоговая архитектура](#11-итоговая-архитектура)
12. [План реализации](#12-план-реализации)

---

## 1. Архитектурная модель

### Ключевые принципы

```
Transport (raw request)
    ↓
UntypedContext { payload: unknown, metadata: unknown }
    ↓
Pipeline [Middleware₁ → Middleware₂ → ... → Middlewareₙ]
    ↓
TypedContext { input: I, meta: M }
    ↓
Endpoint.handle(input: I, meta: M)
    ↓
ResponseContext
```

### Правила

1. **Pipeline = типовой контракт** между транспортом и endpoint
2. **Metadata — продукт pipeline**, а не свойство endpoint
3. **Endpoint потребляет metadata**, но не определяет её форму
4. **Middleware типизированы** и композируются через типы
5. **Каждый endpoint может иметь свой pipeline**

---

## 2. Типизированный Context

### 2.1 Raw - нормализованные данные от транспорта.

```typescript
/**
 * Данные от транспорта
 * Содержит минимальный, неизменяемый слепок входа транспорта
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
- `Raw` не должен попадать в endpoint
- Транспорт создаёт `Raw`, pipeline его использует

### 2.2 Типизированный контекст

```typescript
/**
 * Контекст pipeline, который эволюционирует через middleware
 */
export interface PipelineContext<TInput = unknown, TMeta = unknown> {
  /** Входные данные (эволюционируют через middleware) */
  input: TInput;

  /** Метаданные, добавляемые middleware */
  meta: TMeta;

  /** Доступ к сырым транспортным данным (только для middleware) */
  raw: Readonly<Raw>;
}

/**
 * Нетипизированный контекст от транспорта (начало pipeline)
 */
export type UntypedContext = PipelineContext<unknown, {}>;
```

### 2.3 Создание контекста транспортом

```typescript
/**
 * Transport создаёт Raw и UntypedContext
 * 
 * @param raw - транспортные данные (payload уже нормализован!)
 */
export function createUntypedContext(raw: Raw): UntypedContext {
  return {
    input: raw.payload,  // уже нормализованные данные
    meta: {},
    raw,
  };
}
```

**Что происходит в транспорте?**

Transport **нормализует данные ДО создания Raw**:
- HTTP: `payload = merge(body, params, query)`
- gRPC: `payload = decodedMessage`
- CLI: `payload = parsedArgs`

Сырые данные (req.body, rawProtobufBytes, argv) **не попадают в pipeline** — они используются только внутри транспорта.

**Примеры для разных транспортов:**

```typescript
// HTTP: Transport нормализует body + params + query
// req.body = { name: "Alice" }
// req.params = { id: "123" }
// req.query = { format: "json" }

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

const ctx = createUntypedContext(raw);
// ctx.input === { name: "Alice", id: "123", format: "json" }

// gRPC: Transport декодирует protobuf
const raw: Raw = {
  transport: 'grpc',
  pattern: 'UserService/Create',
  payload: { name: "Alice", email: "alice@example.com" },  // ← декодировано!
  attributes: grpcMetadata,
};

const ctx = createUntypedContext(raw);
// ctx.input === { name: "Alice", email: "alice@example.com" }

// CLI: Transport парсит argv
const raw: Raw = {
  transport: 'cli',
  pattern: 'create-user',
  payload: { name: "Alice", admin: true },  // ← распарсено!
  attributes: { env: process.env, flags: parsedFlags },
};

const ctx = createUntypedContext(raw);
// ctx.input === { name: "Alice", admin: true }
```

**Ключевой момент:**
- `raw.payload` — это **уже обработанные данные**, готовые для pipeline
- Pipeline не видит и не должен видеть сырые данные транспорта
- Нормализация — ответственность транспорта, не pipeline

---

## 3. Типизированные Middleware

### 3.1 Интерфейс типизированного middleware

```typescript
/**
 * Типизированный middleware преобразует контекст
 * 
 * Получает 4 параметра:
 * - input: входные данные
 * - meta: метаданные
 * - raw: сырые транспортные данные (только для middleware!)
 * - next: функция для передачи управления
 */
export type TypedMiddleware<
  TInputIn,
  TMetaIn,
  TInputOut,
  TMetaOut,
> = (
  input: TInputIn,
  meta: TMetaIn,
  raw: Raw,
  next: (input: TInputOut, meta: TMetaOut) => Promise<ResponseContext>,
) => Promise<ResponseContext>;
```

**Важные правила:**

1. ✅ Middleware **могут** читать `raw.attributes` и `raw.payload`
2. ✅ Middleware **могут** трансформировать `input` и `meta`
3. ❌ Endpoint **никогда не видит** `raw`
4. ❌ Если endpoint нужны данные из `raw` - это ошибка архитектуры

### 3.2 Middleware Builder Functions

Вместо классов, используем builder-функции для создания типизированных middleware:

```typescript
/**
 * Добавляет identity в metadata
 * 
 * Читает raw.attributes для извлечения токена/сессии
 */
export function withIdentity<TUser>() {
  return <TInput, TMeta>(
    authenticate: (raw: Raw) => Promise<TUser>,
  ): TypedMiddleware<TInput, TMeta, TInput, TMeta & { identity: TUser }> => {
    return async (input, meta, raw, next) => {
      const identity = await authenticate(raw);

      return next(input, {
        ...meta,
        identity,
      } as TMeta & { identity: TUser });
    };
  };
}

/**
 * Примеры использования для разных транспортов:
 */

// HTTP
const httpAuth = withIdentity<User>()(async (raw) => {
  const headers = raw.attributes as Record<string, string>;
  const token = headers['authorization'];
  return await verifyJWT(token);
});

// gRPC
const grpcAuth = withIdentity<User>()(async (raw) => {
  const metadata = raw.attributes as GrpcMetadata;
  const token = metadata.get('authorization')[0];
  return await verifyJWT(token);
});

// CLI
const cliAuth = withIdentity<User>()(async (raw) => {
  const attrs = raw.attributes as { env: NodeJS.ProcessEnv };
  const token = attrs.env['API_TOKEN'];
  return await verifyJWT(token);
});

/**
 * Валидирует и типизирует input
 */
export function validateInput<TSchema extends Schema>(
  schema: TSchema,
): TypedMiddleware<unknown, any, z.infer<TSchema>, any> {
  return async (input, meta, raw, next) => {
    const validated = schema.parse(input);
    return next(validated, meta);
  };
}

/**
 * Добавляет произвольное поле в metadata
 */
export function withMeta<TKey extends string, TValue>(
  key: TKey,
  getValue: (input: any, meta: any, raw: Raw) => Promise<TValue> | TValue,
): TypedMiddleware<any, any, any, any & Record<TKey, TValue>> {
  return async (input, meta, raw, next) => {
    const value = await getValue(input, meta, raw);

    return next(input, {
      ...meta,
      [key]: value,
    } as any);
  };
}

/**
 * Добавляет permissions в metadata
 */
export function withPermissions<TPermissions>() {
  return <TInput, TMeta extends { identity: any }>(
    getPermissions: (identity: TMeta['identity']) => Promise<TPermissions>,
  ): TypedMiddleware<TInput, TMeta, TInput, TMeta & { permissions: TPermissions }> => {
    return async (input, meta, raw, next) => {
      const permissions = await getPermissions(meta.identity);

      return next(input, {
        ...meta,
        permissions,
      } as TMeta & { permissions: TPermissions });
    };
  };
}

/**
 * Timing middleware (не меняет типы)
 */
export function withTiming(): TypedMiddleware<any, any, any, any> {
  return async (input, meta, raw, next) => {
    const start = Date.now();
    const response = await next(input, meta);
    const duration = Date.now() - start;

    if (!response.headers) {
      response.headers = {};
    }
    response.headers['X-Response-Time'] = `${duration}ms`;

    return response;
  };
}

/**
 * Logging middleware (не меняет типы)
 */
export function withLogging(
  logger: { log: (msg: string) => void },
): TypedMiddleware<any, any, any, any> {
  return async (input, meta, raw, next) => {
    logger.log(`[${raw.transport}] ${raw.pattern} - started`);
    const response = await next(input, meta);
    logger.log(`[${raw.transport}] ${raw.pattern} - completed`);
    return response;
  };
}

/**
 * Извлекает requestId из транспортных атрибутов
 */
export function withRequestId(): TypedMiddleware<
  any,
  any,
  any,
  any & { requestId: string }
> {
  return async (input, meta, raw, next) => {
    let requestId: string;

    if (raw.transport === 'http') {
      const headers = raw.attributes as Record<string, string>;
      requestId = headers['x-request-id'] || crypto.randomUUID();
    } else if (raw.transport === 'grpc') {
      const metadata = raw.attributes as GrpcMetadata;
      requestId = metadata.get('x-request-id')[0] || crypto.randomUUID();
    } else {
      requestId = crypto.randomUUID();
    }

    return next(input, {
      ...meta,
      requestId,
    } as any);
  };
}
```

---

## 4. Типизированный Pipeline

### 4.1 Новый класс TypedPipeline

```typescript
/**
 * Типизированный pipeline с проверкой типов на уровне компиляции
 * 
 * TInputIn, TMetaIn   - входные типы (от транспорта)
 * TInputOut, TMetaOut - выходные типы (для endpoint)
 */
export class TypedPipeline<
  TInputIn,
  TMetaIn,
  TInputOut,
  TMetaOut,
> {
  private readonly middlewares: TypedMiddleware<any, any, any, any>[] = [];

  /**
   * Приватный конструктор - создание только через builder
   */
  private constructor(middlewares: TypedMiddleware<any, any, any, any>[]) {
    this.middlewares = middlewares;
  }

  /**
   * Создаёт пустой pipeline (identity transformation)
   */
  static empty(): TypedPipeline<unknown, {}, unknown, {}> {
    return new TypedPipeline([]);
  }

  /**
   * Добавляет middleware в конец цепочки
   * 
   * Middleware принимает текущий Output и производит новый Output
   */
  use<TInputNext, TMetaNext>(
    middleware: TypedMiddleware<TInputOut, TMetaOut, TInputNext, TMetaNext>,
  ): TypedPipeline<TInputIn, TMetaIn, TInputNext, TMetaNext> {
    return new TypedPipeline([...this.middlewares, middleware]);
  }

  /**
   * Выполняет пайплайн с handler
   * 
   * @param handler - бизнес-логика endpoint (получает только input и meta)
   * @param untypedCtx - нетипизированный контекст от транспорта
   */
  async executeWithHandler<TOutput>(
    handler: (
      input: TInputOut,
      meta: TMetaOut,
    ) => OutputSync<TOutput> | Output<TOutput>,
    untypedCtx: UntypedContext,
  ): Promise<ResponseContext<TOutput>> {
    try {
      let currentInput: any = untypedCtx.input;
      let currentMeta: any = untypedCtx.meta;
      const raw: Raw = untypedCtx.raw;

      // Выполняем цепочку middleware
      for (const middleware of this.middlewares) {
        let nextCalled = false;
        let nextInput: any;
        let nextMeta: any;

        const response = await middleware(
          currentInput,
          currentMeta,
          raw,
          async (input, meta) => {
            nextCalled = true;
            nextInput = input;
            nextMeta = meta;
            // Возвращаем фиктивный response, т.к. мы ещё не в конце
            return null as any;
          },
        );

        // Если middleware вернул response напрямую (не вызвав next)
        if (!nextCalled) {
          return response;
        }

        currentInput = nextInput;
        currentMeta = nextMeta;
      }

      // Вызываем handler с типизированными input и meta
      // Handler НЕ получает raw!
      const result = await handler(currentInput, currentMeta);
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
 * Type helpers для извлечения типов из pipeline
 */
export type InferPipelineInput<P> =
  P extends TypedPipeline<any, any, infer TInputOut, any> ? TInputOut : never;

export type InferPipelineMeta<P> =
  P extends TypedPipeline<any, any, any, infer TMetaOut> ? TMetaOut : never;
```

---

## 5. Pipeline Builder API

### 5.1 Fluent Builder

```typescript
/**
 * Builder для создания типизированных пайплайнов
 */
export function definePipeline() {
  return TypedPipeline.empty();
}

/**
 * Пример использования:
 */
const userPipeline = definePipeline()
  .use(withTiming())
  .use(validateInput(CreateUserSchema))
  .use(
    withIdentity<User>()(async (raw) => {
      // Читаем токен из raw.attributes
      if (raw.transport === 'http') {
        const headers = raw.attributes as Record<string, string>;
        return await authenticateUser(headers['authorization']);
      }
      throw new Error('Unsupported transport');
    }),
  )
  .use(
    withPermissions<Permission[]>()(async (identity) => {
      return await loadPermissions(identity.id);
    }),
  );

// Тип userPipeline:
// TypedPipeline<
//   unknown,                              // input in
//   {},                                   // meta in
//   CreateUserInput,                      // input out
//   { identity: User; permissions: Permission[] }  // meta out
// >
```

### 5.2 Переиспользуемые композиции

```typescript
/**
 * Базовый HTTP pipeline с timing и логированием
 */
export function baseHttpPipeline(logger: Logger) {
  return definePipeline()
    .use(withTiming())
    .use(withLogging(logger));
}

/**
 * Pipeline с сессионной авторизацией
 */
export function withSessionAuth<TSchema extends Schema>(
  inputSchema: TSchema,
  authService: AuthService,
) {
  return baseHttpPipeline(logger)
    .use(validateInput(inputSchema))
    .use(
      withIdentity<User>()(async (raw) => {
        const headers = raw.attributes as Record<string, string>;
        const sessionId = headers['cookie'];
        return await authService.verifySession(sessionId);
      }),
    );
}

/**
 * Pipeline с API key авторизацией
 */
export function withApiKeyAuth<TSchema extends Schema>(
  inputSchema: TSchema,
  authService: AuthService,
) {
  return baseHttpPipeline(logger)
    .use(validateInput(inputSchema))
    .use(
      withIdentity<ApiClient>()(async (raw) => {
        const headers = raw.attributes as Record<string, string>;
        const apiKey = headers['x-api-key'];
        return await authService.verifyApiKey(apiKey);
      }),
    );
}
```

---

## 6. Интеграция с Endpoint

### 6.1 Обновлённый IEndpoint

```typescript
/**
 * Интерфейс для endpoint с типами из pipeline
 */
export interface IEndpoint<
  I = unknown,
  M = unknown,
  O = unknown,
> {
  handle(
    input: I,
    meta: M,
  ): OutputSync<O> | Output<O>;
}
```

**Важно:** Больше нет generics для схем - только конкретные типы!

### 6.2 Вариант A: Декоратор @UsePipeline

```typescript
/**
 * Декоратор для привязки pipeline к endpoint
 */
export function UsePipeline<TInputOut, TMetaOut>(
  pipeline: TypedPipeline<unknown, {}, TInputOut, TMetaOut>,
) {
  return <
    T extends new (...args: any[]) => IEndpoint<TInputOut, TMetaOut, any>,
  >(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем pipeline в метаданных
    (target as any)[PIPELINE_KEY] = pipeline;
    return target;
  };
}

/**
 * Symbol для хранения pipeline
 */
const PIPELINE_KEY = Symbol.for('nestling:pipeline');

/**
 * Извлекает pipeline из класса
 */
export function getEndpointPipeline(
  target: any,
): TypedPipeline<unknown, {}, any, any> | null {
  const constructor = target.prototype ? target : target.constructor;
  return constructor[PIPELINE_KEY] || null;
}
```

### 6.3 Вариант B: Pipeline в HttpEndpoint

```typescript
/**
 * HttpEndpoint с pipeline
 */
export function HttpEndpoint<
  TInputOut,
  TMetaOut,
  TOutput,
>(
  method: Router.HTTPMethod,
  path: string,
  options: {
    pipeline: TypedPipeline<unknown, {}, TInputOut, TMetaOut>;
    output?: Schema | OutputModifier<TOutput>;
  },
) {
  return <
    T extends new (...args: any[]) => IEndpoint<TInputOut, TMetaOut, TOutput>,
  >(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем метаданные
    (target as any)[HANDLER_KEY] = {
      transport: 'http',
      pattern: `${method} ${path}`,
      pipeline: options.pipeline,
      output: options.output,
      className: context.name,
    };

    registerEndpoint(target as Constructor<IEndpoint>);

    return target;
  };
}
```

### 6.4 Обновлённый EndpointMetadata

```typescript
export interface EndpointMetadata<
  TInputOut = any,
  TMetaOut = any,
  TOutput = any,
> {
  transport: string;
  pattern: string;

  /** Pipeline определяет типы input и metadata */
  pipeline: TypedPipeline<unknown, {}, TInputOut, TMetaOut>;

  /** Только output схема - input и metadata идут из pipeline */
  output?: Schema | OutputModifier<TOutput>;
}
```

---

## 7. Примеры использования

### 7.1 Простой endpoint без auth

```typescript
const createUserPipeline = definePipeline()
  .use(validateInput(CreateUserSchema));

@Injectable([UserService, ILogger])
@HttpEndpoint('POST', '/api/users', {
  pipeline: createUserPipeline,
  output: CreateUserOutput,
})
export class CreateUserEndpoint implements IEndpoint<
  CreateUserInput, // из pipeline
  {},              // мета пустая
  CreateUserOutput
> {
  constructor(
    private users: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(
    input: CreateUserInput,
    meta: {},
  ): Output<CreateUserOutput> {
    // input уже провалидирован
    const user = await this.users.create(input);
    return Ok.created(user);
  }
}
```

### 7.2 Endpoint с авторизацией

```typescript
// Определяем pipeline отдельно
const authenticatedPipeline = definePipeline()
  .use(validateInput(UpdateUserSchema))
  .use(
    withIdentity<User>()(async (raw) => {
      // Читаем токен из raw.attributes
      const headers = raw.attributes as Record<string, string>;
      const token = headers['authorization'];
      return await verifyToken(token);
    }),
  )
  .use(
    withPermissions<Permission[]>()(async (identity) => {
      return await loadPermissions(identity.id);
    }),
  );

// Выводим типы из pipeline
type AuthInput = InferPipelineInput<typeof authenticatedPipeline>;
type AuthMeta = InferPipelineMeta<typeof authenticatedPipeline>;

@Injectable([UserService])
@HttpEndpoint('PUT', '/api/users/:id', {
  pipeline: authenticatedPipeline,
  output: UpdateUserOutput,
})
export class UpdateUserEndpoint implements IEndpoint<
  UpdateUserInput,                    // из pipeline
  { identity: User; permissions: Permission[] }, // из pipeline
  UpdateUserOutput
> {
  constructor(private users: UserService) {}

  async handle(
    input: UpdateUserInput,
    meta: { identity: User; permissions: Permission[] },
  ): Output<UpdateUserOutput> {
    // Проверка прав в бизнес-логике
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
// Общий сервис с бизнес-логикой
@Injectable()
class UserService {
  async createUser(data: CreateUserInput): Promise<User> {
    // Бизнес-логика
  }
}

// Pipeline для внутреннего API (сессия)
const internalPipeline = definePipeline()
  .use(validateInput(CreateUserSchema))
  .use(withIdentity<User>()(verifySession));

// Pipeline для внешнего API (API key)
const externalPipeline = definePipeline()
  .use(validateInput(CreateUserSchema))
  .use(withIdentity<ApiClient>()(verifyApiKey));

// Endpoint для фронтенда
@Injectable([UserService])
@HttpEndpoint('POST', '/internal/users', {
  pipeline: internalPipeline,
  output: CreateUserOutput,
})
export class CreateUserForFrontend implements IEndpoint<
  CreateUserInput,
  { identity: User },
  CreateUserOutput
> {
  constructor(private users: UserService) {}

  async handle(
    input: CreateUserInput,
    meta: { identity: User },
  ): Output<CreateUserOutput> {
    // meta.identity гарантированно User
    const user = await this.users.createUser(input);
    return Ok.created(user);
  }
}

// Endpoint для внешнего API
@Injectable([UserService])
@HttpEndpoint('POST', '/api/v1/users', {
  pipeline: externalPipeline,
  output: CreateUserOutput,
})
export class CreateUserForAPI implements IEndpoint<
  CreateUserInput,
  { identity: ApiClient },
  CreateUserOutput
> {
  constructor(private users: UserService) {}

  async handle(
    input: CreateUserInput,
    meta: { identity: ApiClient },
  ): Output<CreateUserOutput> {
    // meta.identity гарантированно ApiClient
    const user = await this.users.createUser(input);
    return Ok.created(user);
  }
}
```

### 7.4 Streaming endpoint

```typescript
const streamPipeline = definePipeline()
  .use(
    withIdentity<User>()(verifySession),
  );

@Injectable([UserService])
@HttpEndpoint('GET', '/api/users/export', {
  pipeline: streamPipeline,
  output: stream(ExportUserOutput),
})
export class ExportUsersEndpoint implements IEndpoint<
  unknown,
  { identity: User },
  AsyncIterableIterator<User>
> {
  constructor(private users: UserService) {}

  async handle(
    input: unknown,
    meta: { identity: User },
  ): Output<AsyncIterableIterator<User>> {
    const stream = this.users.exportAll();
    return new Ok(stream, {
      'Content-Type': 'application/x-ndjson',
    });
  }
}
```

---

## 8. Интеграция с транспортами

### 8.1 HttpTransport

Transport нормализует данные и создаёт `Raw` с `UntypedContext`:

```typescript
private async handle(nativeReq: IncomingMessage, nativeRes: ServerResponse): Promise<void> {
  // 1. Находим маршрут
  const route = this.router.find(nativeReq);
  if (!route) {
    nativeRes.statusCode = 404;
    nativeRes.end('Not Found');
    return;
  }

  // 2. Парсим URL для query параметров
  const url = new URL(
    nativeReq.url || '/',
    `http://${nativeReq.headers.host || 'localhost'}`,
  );

  const query = Object.fromEntries(url.searchParams.entries());

  // 3. Парсим body
  const body = await this.parseBody(nativeReq);

  // 4. Нормализуем данные: merge body + query + params
  const normalizedPayload = this.mergePayload(body, query, route.params);

  // 5. Создаём Raw с уже нормализованным payload
  const raw: Raw = {
    transport: 'http',
    pattern: `${nativeReq.method} ${url.pathname}`,
    payload: normalizedPayload,  // ← уже смержено!
    attributes: nativeReq.headers as Record<string, string>,
  };

  // 6. Создаём UntypedContext (берёт payload из raw)
  const untypedCtx = createUntypedContext(raw);

  // 7. Получаем pipeline из endpoint metadata
  const pipeline = route.metadata.pipeline;

  // 8. Выполняем pipeline → handler
  // Middleware получат raw и смогут читать attributes
  // Handler получит только input и meta (raw недоступен)
  const responseContext = await pipeline.executeWithHandler(
    route.handler,
    untypedCtx,
  );

  // 9. Отправляем ответ
  sendResponse(nativeRes, responseContext);
}
```

**Что делает `mergePayload()`?**

```typescript
private mergePayload(
  body: unknown,
  query: Record<string, string>,
  params: Record<string, string>,
): unknown {
  return {
    ...body as Record<string, unknown>,
    ...query,
    ...params,
  };
}
```

### 8.2 Роль транспорта

**Transport отвечает только за:**
- ✅ Парсинг сырых данных транспорта (req.body, req.headers, req.query, req.params)
- ✅ Нормализация payload (merge body + query + params для HTTP)
- ✅ Создание `Raw` с нормализованным payload и attributes
- ✅ Создание `UntypedContext` из Raw
- ✅ Выполнение pipeline
- ✅ Отправка ответа

**Transport НЕ отвечает за:**
- ❌ Валидацию payload (делает middleware через `validateInput()`)
- ❌ Типизацию metadata (делает middleware через `withIdentity()`, `withPermissions()` и т.д.)
- ❌ Интерпретацию `raw.attributes` для бизнес-логики (делает middleware)
- ❌ Авторизацию (делает middleware)
- ❌ Бизнес-логику (делает endpoint)

**Важно:** 
- Transport нормализует данные ДО создания Raw
- Сырые данные (req.body, rawProtobufBytes, argv) остаются внутри транспорта
- Pipeline работает только с нормализованным `raw.payload`

### 8.3 Регистрация endpoint

```typescript
class HttpTransport {
  endpoint<TInputOut, TMetaOut, TOutput>(
    metadata: EndpointMetadata<TInputOut, TMetaOut, TOutput>,
    handler: IEndpoint<TInputOut, TMetaOut, TOutput>,
  ): void {
    this.router.route({
      pattern: metadata.pattern,
      pipeline: metadata.pipeline,
      handler: handler.handle.bind(handler),
      output: metadata.output,
    });
  }
}
```

### 8.4 Примеры для других транспортов

**gRPC Transport:**

```typescript
// 1. Декодируем protobuf message (внутри транспорта)
const decodedMessage = decodeProtobuf(call.request);

// 2. Создаём Raw с декодированным payload
const raw: Raw = {
  transport: 'grpc',
  pattern: 'UserService/CreateUser',
  payload: decodedMessage,  // { name: "Alice", email: "..." }
  attributes: call.metadata, // grpc.Metadata
};

// 3. Создаём UntypedContext
const untypedCtx = createUntypedContext(raw);
```

**CLI Transport:**

```typescript
// 1. Парсим argv (внутри транспорта)
// process.argv = ['node', 'cli', 'create-user', '--name=Alice', '--admin']
const parsedArgs = parseArgv(process.argv);

// 2. Создаём Raw с распарсенным payload
const raw: Raw = {
  transport: 'cli',
  pattern: 'create-user',
  payload: parsedArgs,  // { name: "Alice", admin: true }
  attributes: {
    env: process.env,
    flags: extractedFlags,
  },
};

// 3. Создаём UntypedContext
const untypedCtx = createUntypedContext(raw);
```

**Message Queue Transport:**

```typescript
// 1. Парсим message content (внутри транспорта)
const parsedContent = JSON.parse(message.content.toString());

// 2. Создаём Raw с распарсенным payload
const raw: Raw = {
  transport: 'rabbitmq',
  pattern: 'user.created',
  payload: parsedContent,  // { userId: "123", timestamp: ... }
  attributes: message.properties, // correlation_id, timestamp, etc.
};

// 3. Создаём UntypedContext
const untypedCtx = createUntypedContext(raw);
```

---

## 9. Преимущества архитектуры

### 9.1 Типобезопасность

✅ **Compile-time гарантии:**
- Если pipeline выдаёт `{ identity: User }`, endpoint НЕ МОЖЕТ ожидать `{ identity: ApiClient }`
- Если middleware добавил поле в meta, следующий middleware видит его в типах
- IDE autocomplete работает идеально

### 9.2 Гибкость

✅ **Один endpoint = один pipeline**
- Разные endpoint'ы могут иметь разные pipeline
- Легко создавать вариации одной бизнес-операции

✅ **Композиция**
- Pipeline строятся из переиспользуемых блоков
- Легко создавать базовые pipeline и расширять их

### 9.3 Явность

✅ **Metadata - продукт pipeline:**
- Endpoint видит, откуда берутся данные
- Невозможно "забыть" добавить middleware для `identity`

✅ **Нет магии:**
- Всё явно объявлено
- Типы выводятся автоматически, но прослеживаемо

### 9.4 Простота

✅ **Минимум generics в user code:**
```typescript
// Пользователь пишет:
const pipeline = definePipeline()
  .use(validateInput(Schema))
  .use(withIdentity<User>()(auth));

// Типы выводятся автоматически!
```

✅ **Декларативный стиль:**
- Pipeline читается как спецификация
- Легко понять, что происходит

---

## 10. Потенциальные проблемы и решения

### 10.1 Сложность типов

**Проблема:** TypeScript может не справиться с глубокими цепочками.

**Решение:**
- Использовать `as any` в местах, где inference ломается
- Добавить helper типы для явного указания типов

```typescript
type ExtractMeta<P> = P extends TypedPipeline<any, infer Out>
  ? Out['meta']
  : never;

const pipeline = definePipeline()...;
type Meta = ExtractMeta<typeof pipeline>;
```

### 10.2 Verbosity

**Проблема:** Написание типов для каждого endpoint может быть многословным.

**Решение:**
- Использовать `typeof pipeline.getOutputType()` для вывода типов
- Создать helper для автоматического вывода

```typescript
/**
 * Автоматически выводит типы из pipeline
 */
type EndpointFromPipeline<
  P extends TypedPipeline<any, any>,
  O,
> = IEndpoint<
  InferPipelineInput<P>,
  InferPipelineMeta<P>,
  O
>;

// Использование:
export class MyEndpoint implements EndpointFromPipeline<typeof myPipeline, MyOutput> {
  async handle(input, meta) { ... }
}
```

### 10.3 Интеграция с DI

**Вопрос:** Как middleware builder-функции работают с DI?

**Решение:**
- Зависимости передаются явно в builder-функции через замыкания
- Pipeline определяются в момент регистрации endpoint'а, когда DI уже доступен

```typescript
// Вариант 1: Фабричная функция с DI
@Injectable([AuthService])
class PipelineFactory {
  constructor(private auth: AuthService) {}

  createAuthPipeline<TSchema extends Schema>(inputSchema: TSchema) {
    return definePipeline()
      .use(validateInput(inputSchema))
      .use(
        withIdentity<User>()(async (raw) => {
          // Читаем токен из raw.attributes
          const headers = raw.attributes as Record<string, string>;
          const token = headers['authorization'];
          return this.auth.verify(token);
        }),
      );
  }
}

// Вариант 2: Прямая передача зависимостей
const authService = container.get(AuthService);

const pipeline = definePipeline()
  .use(validateInput(Schema))
  .use(
    withIdentity<User>()(async (raw) => {
      const headers = raw.attributes as Record<string, string>;
      return authService.verify(headers['authorization']);
    }),
  );

// Вариант 3: Middleware с захватом зависимостей
const createAuthMiddleware = (authService: AuthService) => {
  return withIdentity<User>()(async (raw) => {
    if (raw.transport === 'http') {
      const headers = raw.attributes as Record<string, string>;
      return authService.verifyHTTP(headers);
    }
    if (raw.transport === 'grpc') {
      const metadata = raw.attributes as GrpcMetadata;
      return authService.verifyGRPC(metadata);
    }
    throw new Error('Unsupported transport');
  });
};
```

---

## 11. Итоговая архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                        Transport                            │
│  (HTTP, gRPC, CLI, Message Queue, ...)                     │
│                                                             │
│  1. Парсит сырой request (body, headers, params, query)   │
│  2. Нормализует payload (merge body+query+params для HTTP)│
│  3. Создаёт Raw { transport, pattern, payload, attributes }│
│     payload уже нормализован!                              │
│  4. Создаёт UntypedContext из Raw                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         TypedPipeline<InputIn, MetaIn, InputOut, MetaOut>   │
│                                                             │
│  Middleware₁(input, meta, raw, next)                       │
│    ↓ преобразует                                           │
│  Middleware₂(input', meta', raw, next)                     │
│    ↓ добавляет                                             │
│  Middleware₃(input'', meta'', raw, next)                   │
│    ↓ валидирует                                            │
│  ...                                                        │
│                                                             │
│  • raw доступен всем middleware (readonly)                 │
│  • meta эволюционирует: {} → { identity } → { permissions }│
│  • input типизируется: unknown → ValidatedInput            │
│  • Типы проверяются compile-time!                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            Endpoint.handle(input: I, meta: M)               │
│                                                             │
│  • Получает только input и meta (2 параметра)              │
│  • raw НЕДОСТУПЕН (только middleware видят raw)            │
│  • Типы гарантированы pipeline                             │
│  • Транспортно-независим                                   │
│  • Реализует бизнес-логику                                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    ResponseContext                          │
│  { isSuccess, status, value, headers }                     │
│  (возвращается через transport)                             │
└─────────────────────────────────────────────────────────────┘
```

### Ключевые моменты архитектуры:

1. **Raw - транспортный контейнер**
   - `payload` — уже нормализованные данные (не сырые!)
   - `attributes` — транспортно-специфичные метаданные
   - Создаётся транспортом
   - Доступен только middleware
   - Никогда не попадает в endpoint

2. **Transport - нормализатор**
   - Парсит сырые данные транспорта (body, headers, query, params)
   - Нормализует payload ДО создания Raw
   - Сырые данные (req.body, rawProtobufBytes, argv) остаются внутри транспорта
   - Pipeline не видит и не должен видеть сырые данные

3. **Pipeline - независим от транспорта**
   - Работает с нормализованным `payload` и `attributes`
   - Не знает, HTTP это или gRPC
   - Middleware интерпретируют `raw.attributes` по-своему

4. **Endpoint - чистая бизнес-логика**
   - Получает только `input` и `meta` (2 параметра)
   - Не видит транспортных деталей
   - Не видит `raw`
   - Типы гарантированы pipeline

5. **Middleware - инфраструктурный слой**
   - 4 параметра: `input, meta, raw, next`
   - Могут читать `raw.payload` и `raw.attributes`
   - Эволюционируют `input` и `meta`
   - Типизированы на уровне компиляции

---

## 12. План реализации

### Фаза 1: Ядро типизации

1. **PipelineContext и базовые типы**
   - Реализовать `PipelineContext<I, M>`
   - Реализовать `UntypedContext`
   - Реализовать `TypedMiddleware<TCtxIn, TCtxOut>`

2. **TypedPipeline**
   - Реализовать класс `TypedPipeline<TCtxIn, TCtxOut>`
   - Реализовать метод `use()` с правильным выводом типов
   - Реализовать `executeWithHandler()`

3. **Builder API**
   - Реализовать `definePipeline()`
   - Проверить корректность вывода типов в цепочках

### Фаза 2: Middleware Builders

4. **Базовые middleware**
   - `validateInput()` - валидация и типизация input
   - `withTiming()` - измерение времени
   - `withLogging()` - логирование

5. **Auth middleware**
   - `withIdentity<T>()` - добавление identity
   - `withPermissions<T>()` - добавление permissions
   - `withMeta<K, V>()` - generic добавление полей

### Фаза 3: Интеграция с Endpoint

6. **Обновление IEndpoint**
   - Упростить до `IEndpoint<I, M, O>`
   - Убрать работу со схемами

7. **Обновление декораторов**
   - Обновить `HttpEndpoint()` для работы с pipeline
   - Обновить `EndpointMetadata`
   - Убрать `input` и `metadata` схемы

### Фаза 4: Обновление транспортов

8. **HttpTransport**
   - Обновить для работы с `TypedPipeline`
   - Реализовать создание `UntypedContext`
   - Убрать валидацию из транспорта

9. **Другие транспорты**
   - CliTransport
   - Будущие транспорты

### Фаза 5: Примеры и документация

10. **Примеры**
    - Простой endpoint без auth
    - Endpoint с авторизацией
    - Разные pipelines для одной операции
    - Streaming endpoint

11. **Документация**
    - Руководство по созданию pipeline
    - Руководство по созданию middleware
    - Best practices
    - Cookbook с типичными patterns

---

## Заключение

Предложенная архитектура решает все ключевые проблемы из дискуссий:

✅ **Pipeline = типовой контракт** 
- Metadata определяется pipeline, а не endpoint
- Endpoint потребляет типы, не определяет их

✅ **Raw = транспортный контейнер**
- Минимальный, неизменяемый слепок входа транспорта
- Доступен только middleware (endpoint НЕ видит)
- Универсален для всех транспортов (HTTP, gRPC, CLI, ...)

✅ **Типобезопасность** 
- Compile-time проверка совместимости pipeline и endpoint
- Middleware типизированы: `(input, meta, raw, next) => ...`
- Handler типизирован: `(input, meta) => ...`
- IDE autocomplete работает идеально

✅ **Transport-agnostic Pipeline**
- Pipeline независим от транспорта
- Работает с абстрактным `payload` и `attributes`
- Middleware сами решают, как интерпретировать `raw.attributes`
- Один и тот же middleware может работать с разными транспортами

✅ **Гибкость** 
- Каждый endpoint может иметь свой pipeline
- Легко создавать вариации одной бизнес-операции
- Разные identity типы для разных endpoint'ов
- Middleware композируются естественно

✅ **Простота** 
- Декларативный API с автоматическим выводом типов
- Минимум generics в user code
- Читаемые pipeline определения
- Handler получает только 2 параметра

✅ **Явность** 
- Нет магии, всё прослеживаемо
- Источник каждого поля в metadata очевиден
- `raw` явно отделён от бизнес-данных
- Типы документируют поведение

✅ **Композиция** 
- Pipeline строятся из переиспользуемых блоков
- Легко создавать базовые pipeline и расширять их
- Middleware builder-функции композируются естественно

### Ключевое правило архитектуры:

> ❗ **Endpoint запрещено читать `raw`**
> 
> Если endpoint нужны данные из `raw.attributes` — это middleware.
> Middleware извлекает данные и кладёт их в `meta`.
> Endpoint работает только с типизированным `meta`.

Эта архитектура обеспечивает правильный баланс между:
- Строгостью типов и удобством использования
- Универсальностью (transport-agnostic) и специфичностью (transport-aware middleware)
- Сложностью реализации и простотой использования

Следуя принципу: **"Сложность в библиотеке, простота в использовании"**
