/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */

import { CreateUser, ExportLogs, SayHello } from './endpoints/index.js';

import { makeDispatch } from '@nestlingjs/app';
import { HttpServer, HttpTransport } from '@nestlingjs/transport.http';

/**
 * HTTP-сервер без `assemble`: сервер и транспорт создаются напрямую,
 * таблицу маршрутов строит `makeDispatch`, обработчик присоединяет
 * `serve`, сокет открывает `listen`.
 */
const PORT = Number(process.env.PORT) || 3000;

const server = new HttpServer({ port: PORT, host: '0.0.0.0' });
const transport = new HttpTransport(server);

// У деклараций нет зависимостей, поэтому `makeDispatch` принимает их как есть
const dispatch = makeDispatch([SayHello, CreateUser, ExportLogs]);

// Общий сигнал остановки: после взвода транспорт не принимает новые запросы
const shutdown = new AbortController();

transport
  .serve(dispatch, shutdown.signal)
  // Порядок тот же, что на фазе START: обработчик присоединён, и только
  // потом открывается сокет
  .then(() => server.listen())
  .then(() => {
    console.log(`HTTP server listening on http://localhost:${PORT}`);
  })
  .catch((error: unknown) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });

// Остановка тем же реверсом: сигнал, дренаж соединений сервером, отмена
// запросов в обработке транспортом
const stop = async (signal: string): Promise<void> => {
  console.log(`${signal} received, shutting down`);
  shutdown.abort();
  await server.drain();
  await transport.close();
  process.exit(0);
};

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
