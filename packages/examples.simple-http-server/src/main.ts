/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */

import { CreateUser, ExportLogs, SayHello } from './endpoints';

import { makeDispatch } from '@nestling/transport';
import { HttpTransport } from '@nestling/transport.http';

/**
 * HTTP-сервер без `assemble`: транспорт создаётся напрямую, таблицу
 * маршрутов строит `makeDispatch`, сервер запускает `serve`.
 */
const PORT = Number(process.env.PORT) || 3000;

const server = new HttpTransport({ port: PORT });

// У деклараций нет `deps`, поэтому `makeDispatch` принимает их как есть
const dispatch = makeDispatch([SayHello, CreateUser, ExportLogs]);

// Общий сигнал остановки: после взвода транспорт не принимает новые запросы
const shutdown = new AbortController();

server
  .serve(dispatch, shutdown.signal)
  .then(() => {
    console.log(`HTTP server listening on http://localhost:${PORT}`);
  })
  .catch((error: unknown) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });

// Остановка: сигнал отменяет выполняющиеся запросы, `close()` ждёт соединения
const stop = async (signal: string): Promise<void> => {
  console.log(`${signal} received, shutting down`);
  shutdown.abort();
  await server.close();
  process.exit(0);
};

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
