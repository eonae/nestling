/* eslint-disable no-console */

import {
  App,
  CliTransport,
  createInputSources,
  define,
  extractDescription,
  forType,
  HttpTransport,
  parseMetadata,
  parsePayload,
  type RequestContext,
} from '@nestling/transport';
import { z } from 'zod';

/**
 * Комплексная демонстрация Schema-Driven Input системы
 *
 * Демонстрирует:
 * 1. Разделение payload и metadata
 * 2. Сужение типов (optional → required)
 * 3. Валидацию через Zod
 * 4. Transport-агностичные handler'ы
 * 5. Генерацию описаний для документации
 */

// ============================================================================
// 1. Определение proto-типов (могут быть из ts-proto)
// ============================================================================

interface CreateUserProto {
  name: string;
  email: string;
  age?: number;
  address?: {
    street: string;
    city: string;
    zipCode: string;
  };
}

interface UpdateUserProto {
  id: string;
  name?: string;
  email?: string;
}

// ============================================================================
// 2. Определение domain схем (сужаем типы)
// ============================================================================

const CreateUserSchema = forType<CreateUserProto>().defineModel(
  z.object({
    name: z
      .string()
      .min(1)
      .max(100)
      .describe('Имя пользователя (обязательное, 1-100 символов)'),
    email: z
      .string()
      .email()
      .describe('Email адрес (обязательный, валидный email)'),
    age: z
      .number()
      .int()
      .min(0)
      .max(150)
      .optional()
      .describe('Возраст пользователя (опциональный, 0-150)'),
    address: z
      .object({
        street: z.string().min(1),
        city: z.string().min(1),
        zipCode: z.string().regex(/^\d{5}$/),
      })
      .describe(
        'Адрес пользователя (обязателен, содержит street, city, zipCode)',
      ),
  }),
);

const UpdateUserSchema = forType<UpdateUserProto>().defineModel(
  z.object({
    id: z.string().describe('ID пользователя из path параметра'),
    name: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Новое имя пользователя (опциональное)'),
    email: z.email().optional().describe('Новый email адрес (опциональный)'),
  }),
);

// ============================================================================
// 3. Metadata схемы (авторизация, tracing и т.п.)
// ============================================================================

const AuthSchema = define(
  z.object({
    authorization: z
      .string()
      .regex(/^Bearer .+$/)
      .transform((val: string) => val.replace('Bearer ', ''))
      .describe('Bearer токен из заголовка Authorization'),
    userId: z
      .string()
      .optional()
      .describe('ID пользователя из заголовка X-User-Id'),
  }),
);

const TracingSchema = define(
  z.object({
    'x-request-id': z
      .string()
      .uuid()
      .optional()
      .describe('Request ID для трейсинга'),
    'x-trace-id': z
      .string()
      .uuid()
      .optional()
      .describe('Trace ID для распределённого трейсинга'),
  }),
);

// ============================================================================
// 4. HTTP Transport с schema-driven handler'ами
// ============================================================================

const httpTransport = new HttpTransport({
  port: Number(process.env.PORT) || 3001,
});

const app = new App({
  http: httpTransport,
});

// Middleware для логирования
httpTransport.use(async (ctx, next) => {
  console.log(`→ ${ctx.method} ${ctx.path}`);
  const start = Date.now();
  const response = await next();
  const duration = Date.now() - start;
  console.log(
    `← ${ctx.method} ${ctx.path} - ${response.status || 200} (${duration}ms)`,
  );
  return response;
});

// POST /users - создание пользователя со схемой
app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/users',
  input: {
    body: 'json',
  },
  handler: async (ctx: RequestContext) => {
    const sources = createInputSources(ctx);
    const user = parsePayload(CreateUserSchema, sources);

    // user имеет строгий тип:
    // { name: string; email: string; age?: number; address: { street: string; city: string; zipCode: string } }
    // address теперь обязателен благодаря валидатору!

    return {
      status: 201,
      value: {
        message: 'User created with schema validation',
        user: {
          id: Math.floor(Math.random() * 1000),
          ...user,
        },
      },
      meta: {},
    };
  },
});

// PUT /users/:id - обновление пользователя (params + body)
app.registerHandler({
  transport: 'http',
  method: 'PUT',
  path: '/users/:id',
  input: {
    body: 'json',
  },
  handler: async (ctx: RequestContext) => {
    const sources = createInputSources(ctx);
    const update = parsePayload(UpdateUserSchema, sources);

    // update имеет тип: { id: number; name?: string; email?: string }
    // id автоматически преобразован в number благодаря transform

    return {
      status: 200,
      value: {
        message: 'User updated',
        user: {
          id: update.id,
          ...(update.name && { name: update.name }),
          ...(update.email && { email: update.email }),
        },
      },
      meta: {},
    };
  },
});

// POST /users/secure - создание с авторизацией
app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/users/secure',
  input: {
    body: 'json',
  },
  handler: async (ctx: RequestContext) => {
    const sources = createInputSources(ctx);
    const user = parsePayload(CreateUserSchema, sources);
    const auth = parseMetadata(AuthSchema, sources);
    const tracing = parseMetadata(TracingSchema, sources);

    // auth имеет тип: { authorization: string; userId?: string }
    // authorization уже очищен от префикса "Bearer "

    return {
      status: 201,
      value: {
        message: 'User created with authentication',
        user: {
          id: Math.floor(Math.random() * 1000),
          ...user,
        },
        auth: {
          token: auth.authorization,
          userId: auth.userId,
        },
        tracing: {
          requestId: tracing['x-request-id'],
          traceId: tracing['x-trace-id'],
        },
      },
      meta: {},
    };
  },
});

// GET /schemas/:name - получение описания схемы (для документации)
app.registerHandler({
  transport: 'http',
  method: 'GET',
  path: '/schemas/:name',
  handler: async (ctx: RequestContext) => {
    const payload = ctx.payload as Record<string, string> | undefined;
    const schemaName = payload?.name;

    let descriptions: Record<string, string | undefined> = {};

    switch (schemaName) {
      case 'create-user': {
        descriptions = extractDescription(CreateUserSchema);
        break;
      }
      case 'update-user': {
        descriptions = extractDescription(UpdateUserSchema);
        break;
      }
      case 'auth': {
        descriptions = extractDescription(AuthSchema);
        break;
      }
      default: {
        return {
          status: 404,
          value: { error: 'Schema not found' },
          meta: {},
        };
      }
    }

    return {
      status: 200,
      value: {
        schema: schemaName,
        fields: descriptions,
      },
      meta: {},
    };
  },
});

// ============================================================================
// 5. CLI Transport с schema-driven командами
// ============================================================================

const cliTransport = new CliTransport();

const cliApp = new App({
  cli: cliTransport,
});

// Схема для CLI команды
const CreateUserCliSchema = define(
  z.object({
    name: z.string().min(1).describe('Имя пользователя'),
    email: z.string().email().describe('Email адрес'),
  }),
);

// create-user - создание пользователя через CLI
cliApp.registerHandler({
  transport: 'cli',
  command: 'create-user',
  handler: async (ctx) => {
    const payload = ctx.payload as {
      args: string[];
      name?: string;
      email?: string;
    };

    // Преобразуем CLI input
    const input = {
      name: payload.name || payload.args[0] || '',
      email: payload.email || payload.args[1] || '',
    };

    // Валидируем через схему
    const validated = CreateUserCliSchema.parse(input);
    const { name, email } = validated;

    console.log(`Creating user: ${name} (${email})`);

    return {
      status: 0,
      value: {
        message: 'User created',
        user: { name, email },
      },
      meta: {},
    };
  },
});

// ============================================================================
// 6. Запуск приложения
// ============================================================================

const PORT = Number(process.env.PORT) || 3001;

app
  .listen()
  .then(() => {
    console.log(
      `\n🚀 Schema Demo Server running on http://localhost:${PORT}\n`,
    );
    console.log('Available routes:');
    console.log('  POST /users              - Create user (with schema)');
    console.log('  PUT  /users/:id           - Update user (params + body)');
    console.log('  POST /users/secure        - Create user with auth');
    console.log('  GET  /schemas/:name       - Get schema description');
    console.log('\nTry:');
    console.log(
      `  curl -X POST http://localhost:${PORT}/users -H "Content-Type: application/json" -d '{"name":"Alice","email":"alice@example.com","address":{"street":"Main St","city":"NYC","zipCode":"10001"}}'`,
    );
    console.log(
      `  curl -X PUT http://localhost:${PORT}/users/42 -H "Content-Type: application/json" -d '{"name":"Bob"}'`,
    );
    console.log(
      `  curl -X POST http://localhost:${PORT}/users/secure -H "Content-Type: application/json" -H "Authorization: Bearer token123" -H "X-Request-Id: $(uuidgen)" -d '{"name":"Alice","email":"alice@example.com","address":{"street":"Main St","city":"NYC","zipCode":"10001"}}'`,
    );
    console.log(`  curl http://localhost:${PORT}/schemas/create-user`);
    console.log('');
  })
  .catch((error: unknown) => {
    console.error('Failed to start server:', error);
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n👋 SIGTERM received, shutting down gracefully...');
  await app.close();
  console.log('✅ Server closed');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n👋 SIGINT received, shutting down gracefully...');
  await app.close();
  console.log('✅ Server closed');
  process.exit(0);
});
