/* eslint-disable no-console */

import { App, HttpTransport, type RequestContext } from '@nestling/transport';

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
    const params = ctx.meta.params as Record<string, string> | undefined;
    const userId = params?.id;
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

// POST /users (с JSON body)
app.registerHandler({
  transport: 'http',
  method: 'POST',
  path: '/users',
  input: {
    body: 'json',
  },
  handler: async (ctx: RequestContext) => {
    const body = ctx.body as { name?: string; email?: string };
    return {
      status: 201,
      value: {
        message: 'User created',
        user: {
          id: Math.floor(Math.random() * 1000),
          name: body.name || 'Unknown',
          email: body.email || 'unknown@example.com',
        },
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
      query: ctx.query,
      headers: ctx.headers,
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
    console.log('  GET  /              - Hello message');
    console.log('  GET  /users         - List users');
    console.log('  GET  /users/:id     - Get user by ID');
    console.log('  POST /users         - Create user (JSON body)');
    console.log('  GET  /echo          - Echo query params and headers');
    console.log('  GET  /stream        - Streaming response');
    console.log('\nTry:');
    console.log(`  curl http://localhost:${PORT}/`);
    console.log(`  curl http://localhost:${PORT}/users`);
    console.log(`  curl http://localhost:${PORT}/users/42`);
    console.log(
      `  curl -X POST http://localhost:${PORT}/users -H "Content-Type: application/json" -d '{"name":"Alice","email":"alice@example.com"}'`,
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
