/* eslint-disable no-console */

import {
  App,
  createInputSources,
  define,
  forType,
  HttpTransport,
  parseMetadata,
  parsePayload,
  type RequestContext,
} from '@nestling/transport';
import { z } from 'zod';

// Создаем HTTP транспорт
const httpTransport = new HttpTransport({
  port: Number(process.env.PORT) || 3000,
});

// Добавляем middleware для логирования
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

// Создаем App с транспортами
const app = new App({
  http: httpTransport,
});

// Регистрируем маршруты

// GET /
app.registerHandler({
  transport: 'http',
  method: 'GET',
  path: '/',
  handler: async () => ({
    status: 200,
    value: {
      message: 'Hello from Nestling HTTP Transport!',
      timestamp: new Date().toISOString(),
    },
    meta: {},
  }),
});

// GET /users
app.registerHandler({
  transport: 'http',
  method: 'GET',
  path: '/users',
  handler: async () => ({
    status: 200,
    value: {
      users: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ],
    },
    meta: {},
  }),
});

// GET /users/:id
app.registerHandler({
  transport: 'http',
  method: 'GET',
  path: '/users/:id',
  handler: async (ctx: RequestContext) => {
    const payload = ctx.payload as Record<string, string> | undefined;
    const userId = payload?.id;
    return {
      status: 200,
      value: {
        user: {
          id: Number(userId),
          name: `User ${userId}`,
        },
      },
      meta: {},
    };
  },
});

// POST /users (с JSON body) - старый подход без схем
app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/users',
  input: {
    body: 'json',
  },
  handler: async (ctx: RequestContext) => {
    const payload = ctx.payload as { name?: string; email?: string };
    return {
      status: 201,
      value: {
        message: 'User created',
        user: {
          id: Math.floor(Math.random() * 1000),
          name: payload?.name || 'Unknown',
          email: payload?.email || 'unknown@example.com',
        },
      },
      meta: {},
    };
  },
});

// Schema-driven примеры

// Определяем proto-тип (может быть из ts-proto)
interface CreateUserProto {
  name: string;
  email: string;
  address?: {
    street: string;
    city: string;
  };
}

// Определяем domain схему (сужаем типы: optional → required)
const CreateUserSchema = forType<CreateUserProto>().defineModel(
  z.object({
    name: z
      .string()
      .min(1)
      .max(100)
      .describe('Имя пользователя (обязательное, 1-100 символов)'),
    email: z.email().describe('Email адрес (обязательный, валидный email)'),
    address: z
      .object({
        street: z.string().min(1).describe('Улица'),
        city: z.string().min(1).describe('Город'),
      })
      .describe(
        'Адрес пользователя (обязателен, содержит street, city, zipCode)',
      ),
  }),
);

// POST /users/schema - создание пользователя со схемой
app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/users/schema',
  input: {
    body: 'json',
  },
  handler: async (ctx: RequestContext) => {
    const sources = createInputSources(ctx);
    const user = parsePayload(CreateUserSchema, sources);

    // user имеет строгий тип:
    // { name: string; email: string; address: { street: string; city: string } }
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

// Схема для получения пользователя по ID (params + query)
const GetUserSchema = define(
  z.object({
    id: z
      .string()
      .transform((val: string) => Number.parseInt(val, 10))
      .describe('ID пользователя из path параметра'),
    include: z
      .enum(['profile', 'posts'])
      .optional()
      .describe('Дополнительные данные для включения (query параметр)'),
  }),
);

// GET /users/schema/:id - получение пользователя со схемой
app.registerHandler({
  transport: 'http',
  method: 'GET',
  path: '/users/schema/:id',
  handler: async (ctx: RequestContext) => {
    const sources = createInputSources(ctx);
    const input = parsePayload(GetUserSchema, sources);

    // input имеет тип: { id: number; include?: 'profile' | 'posts' }
    // id автоматически преобразован в number благодаря transform

    return {
      status: 200,
      value: {
        user: {
          id: input.id,
          name: `User ${input.id}`,
          email: `user${input.id}@example.com`,
          ...(input.include === 'profile' && {
            profile: { bio: 'Some bio' },
          }),
          ...(input.include === 'posts' && {
            posts: [{ id: 1, title: 'Post 1' }],
          }),
        },
      },
      meta: {},
    };
  },
});

// Схема для metadata (авторизация)
const AuthSchema = define(
  z.object({
    authorization: z
      .string()
      .regex(/^Bearer .+$/)
      .transform((val: string) => val.replace('Bearer ', ''))
      .describe('Bearer токен из заголовка Authorization'),
  }),
);

// POST /users/secure - создание пользователя с проверкой авторизации
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

    // auth имеет тип: { authorization: string }
    // authorization уже очищен от префикса "Bearer "

    return {
      status: 201,
      value: {
        message: 'User created with authentication',
        user: {
          id: Math.floor(Math.random() * 1000),
          ...user,
        },
        token: auth.authorization,
      },
      meta: {},
    };
  },
});

// GET /echo (с query параметрами)
app.registerHandler({
  transport: 'http',
  method: 'GET',
  path: '/echo',
  handler: async (ctx: RequestContext) => ({
    status: 200,
    value: {
      payload: ctx.payload,
      metadata: ctx.metadata,
    },
    meta: {},
  }),
});

// GET /stream (streaming response)
app.registerHandler({
  transport: 'http',
  method: 'GET',
  path: '/stream',
  handler: async () => {
    const { Readable } = await import('node:stream');

    const stream = Readable.from(
      (async function* () {
        for (let i = 1; i <= 10; i++) {
          yield `Chunk ${i}\n`;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })(),
    );

    return {
      status: 200,
      headers: {
        'content-type': 'text/plain',
      },
      stream,
      meta: {},
    };
  },
});

const PORT = Number(process.env.PORT) || 3000;

// Запускаем приложение
app
  .listen()
  .then(() => {
    console.log(`\n🚀 HTTP Server running on http://localhost:${PORT}\n`);
    console.log('Available routes:');
    console.log('  GET  /                  - Hello message');
    console.log('  GET  /users             - List users');
    console.log('  GET  /users/:id         - Get user by ID');
    console.log('  POST /users             - Create user (JSON body)');
    console.log(
      '  POST /users/schema      - Create user with schema validation',
    );
    console.log(
      '  GET  /users/schema/:id  - Get user with schema (supports ?include=profile|posts)',
    );
    console.log(
      '  POST /users/secure      - Create user with auth (requires Authorization header)',
    );
    console.log('  GET  /echo              - Echo query params and headers');
    console.log('  GET  /stream            - Streaming response');
    console.log('\nTry:');
    console.log(`  curl http://localhost:${PORT}/`);
    console.log(`  curl http://localhost:${PORT}/users`);
    console.log(`  curl http://localhost:${PORT}/users/42`);
    console.log(
      `  curl -X POST http://localhost:${PORT}/users -H "Content-Type: application/json" -d '{"name":"Alice","email":"alice@example.com"}'`,
    );
    console.log(
      `  curl -X POST http://localhost:${PORT}/users/schema -H "Content-Type: application/json" -d '{"name":"Alice","email":"alice@example.com","address":{"street":"Main St","city":"NYC"}}'`,
    );
    console.log(
      `  curl http://localhost:${PORT}/users/schema/42?include=profile`,
    );
    console.log(
      `  curl -X POST http://localhost:${PORT}/users/secure -H "Content-Type: application/json" -H "Authorization: Bearer token123" -d '{"name":"Alice","email":"alice@example.com","address":{"street":"Main St","city":"NYC"}}'`,
    );
    console.log(`  curl http://localhost:${PORT}/echo?foo=bar&baz=qux`);
    console.log(`  curl http://localhost:${PORT}/stream`);
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
