/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */

import {
  CreateUser,
  ExportLogs,
  SayHello,
  SearchUsers,
  StreamLogs,
  UploadReport,
} from './endpoints';

import { makeDispatch } from '@nestling/transport';
import { HttpTransport } from '@nestling/transport.http';

const PORT = Number(process.env.PORT) || 3000;

// Создаем HTTP транспорт
const server = new HttpTransport({ port: PORT });

// ============================================================
// Standalone-путь: те же примитивы, что под App. Декларации deps-free,
// поэтому `makeDispatch` принимает их как есть — резолвить нечего.
// ============================================================

const dispatch = makeDispatch([
  SayHello,
  CreateUser,
  SearchUsers,
  StreamLogs,
  ExportLogs,
  UploadReport,
]);

// Канал остановки: его взвод — «новые запросы не принимаем»
const shutdown = new AbortController();

// Сервер начинает слушать порт: иначе транспорту нечего маршрутизировать
server
  .serve(dispatch, shutdown.signal)
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
    process.exit(1);
  });

// Graceful shutdown: сигнал отменяет in-flight, close() дренирует соединения
const stop = async (signal: string): Promise<void> => {
  console.log(`\n👋 ${signal} received, shutting down gracefully...`);
  shutdown.abort();
  await server.close();
  console.log('✅ Server closed');
  process.exit(0);
};

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
