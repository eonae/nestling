/* eslint-disable no-console */

import { CreateUser, SayHello, StreamLogs } from './endpoints';

import { HttpTransport } from '@nestling/transport.http';

// Создаем HTTP транспорт
const server = new HttpTransport({
  port: Number(process.env.PORT) || 3000,
});

// ============================================================
// Регистрируем декларации: deps-free — идут в route() как есть
// ============================================================

server.route(SayHello);
server.route(CreateUser);
server.route(StreamLogs);

const PORT = Number(process.env.PORT) || 3000;

// Запускаем HTTP сервер
server
  .listen()
  .then(() => {
    console.log(`\n🚀 HTTP Server running on http://localhost:${PORT}\n`);
    console.log('Available routes:');
    console.log('  GET  /                - Hello message');
    console.log('  POST /users           - Create user');
    console.log('  POST /logs/stream     - Stream logs processing');

    console.log('\nTry:');
    console.log(`  curl http://localhost:${PORT}/`);
    console.log(
      `  curl -X POST http://localhost:${PORT}/users -H "Content-Type: application/json" -d '{"name":"Alice","email":"alice@example.com","address":{"street":"Main St","city":"NYC"}}'`,
    );
    console.log(
      `  echo '{"timestamp":1234567890,"level":"info","message":"Test log"}' | curl -X POST http://localhost:${PORT}/logs/stream -H "Content-Type: application/json" -d @-`,
    );
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
  await server.close();
  console.log('✅ Server closed');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n👋 SIGINT received, shutting down gracefully...');
  await server.close();
  console.log('✅ Server closed');
  process.exit(0);
});
