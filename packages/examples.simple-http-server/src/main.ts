/* eslint-disable no-console */

import { GetUserByIdHandler, ListProducts } from './handlers.class';
import { CreateUser, SayHello } from './handlers.functional';
import { RequestResponseLogging, TimingMiddleware } from './middleware';

import { App } from '@nestling/app';
import { HttpTransport } from '@nestling/transport.http';

// Создаем HTTP транспорт
const httpTransport = new HttpTransport({
  port: Number(process.env.PORT) || 3000,
});

// Добавляем middleware для логирования (функциональный стиль)
httpTransport.use(RequestResponseLogging);

// Добавляем middleware для измерения времени (классовый стиль)
httpTransport.use(TimingMiddleware);

// Создаем App с транспортами
const app = new App({
  http: httpTransport,
});

// ============================================================
// ПОДХОД 1: app.registerHandler (функциональный стиль)
// ============================================================

app.registerHandler(SayHello);
app.registerHandler(CreateUser);

// ============================================================
// ПОДХОД 2: @Handler (классовый стиль)
// ============================================================

app.registerHandler(GetUserByIdHandler);
app.registerHandler(ListProducts);

const PORT = Number(process.env.PORT) || 3000;

// Запускаем приложение
app
  .listen()
  .then(() => {
    console.log(`\n🚀 HTTP Server running on http://localhost:${PORT}\n`);
    console.log('Available routes:');
    console.log('  GET  /                - Hello message');
    console.log('  POST /users           - Create user');
    console.log('  GET  /api/users/:id   - Get user by ID (@Handler)');
    console.log('  GET  /products        - List products (@Handler)');

    console.log('\nTry:');
    console.log(`  curl http://localhost:${PORT}/`);
    console.log(
      `  curl -X POST http://localhost:${PORT}/users -H "Content-Type: application/json" -d '{"name":"Alice","email":"alice@example.com","address":{"street":"Main St","city":"NYC"}}'`,
    );
    console.log(`  curl http://localhost:${PORT}/api/users/42`);
    console.log(
      `  curl "http://localhost:${PORT}/api/users/42?include=profile"`,
    );
    console.log(
      `  curl -H "Authorization: Bearer token123" http://localhost:${PORT}/api/users/42`,
    );
    console.log(`  curl http://localhost:${PORT}/products`);
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
