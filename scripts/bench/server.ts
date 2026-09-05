/**
 * Точка входа дочернего процесса бенчмарка: поднимает один сервер по имени
 * из аргумента, печатает `NODE=<версия>` и `PORT=<порт>` и живёт до
 * `SIGTERM`.
 *
 * Запускается раннером `bench/http.ts`; вручную —
 * `tsx scripts/bench/server.ts fastify`.
 */

import { SERVERS } from './servers.js';

const name = process.argv[2] ?? '';
const start = SERVERS[name];

if (!start) {
  console.error(
    `Неизвестный сервер '${name}'. Известные: ${Object.keys(SERVERS).join(', ')}`,
  );
  process.exit(1);
}

const running = await start();
console.log(`NODE=${process.version}`);
console.log(`PORT=${running.port}`);

const shutdown = async (): Promise<void> => {
  await running.stop();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
