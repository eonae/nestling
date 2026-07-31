/* eslint-disable no-console */

import {
  CreateUser,
  ExportLogs,
  SayHello,
  SearchUsers,
  StreamLogs,
  UploadReport,
} from './endpoints';

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
server.route(SearchUsers);
server.route(StreamLogs);
server.route(ExportLogs);
server.route(UploadReport);

const PORT = Number(process.env.PORT) || 3000;

// Запускаем HTTP сервер
server
  .listen()
  .then(() => {
    console.log(`\n🚀 HTTP Server running on http://localhost:${PORT}\n`);
    console.log('Available routes:');
    console.log('  GET  /                - Hello message');
    console.log('  POST /users           - Create user');
    console.log('  GET  /users           - Search users (query-параметры)');
    console.log('  POST /logs/stream     - Stream logs processing (NDJSON in)');
    console.log('  GET  /logs/export     - Stream logs export (NDJSON out)');
    console.log('  POST /reports         - Upload a report (multipart)');

    console.log('\nTry:');
    console.log(`  curl http://localhost:${PORT}/`);
    console.log(
      `  curl -X POST http://localhost:${PORT}/users -H "Content-Type: application/json" -d '{"name":"Alice","email":"alice@example.com","address":{"street":"Main St","city":"NYC"}}'`,
    );
    console.log(
      `  echo '{"timestamp":1234567890,"level":"info","message":"Test log"}' | curl -X POST http://localhost:${PORT}/logs/stream -H "Content-Type: application/json" -d @-`,
    );
    console.log(
      `  curl 'http://localhost:${PORT}/users?q=ali&tag=admin&tag=ops&limit=5'`,
    );
    console.log(`  curl -N http://localhost:${PORT}/logs/export`);
    console.log(
      `  curl -F title=Q3 -F 'report=@q3.pdf;type=application/pdf' http://localhost:${PORT}/reports`,
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
