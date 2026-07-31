/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */

import { Help, ProcessStdin } from './endpoints';

import { makeDispatch } from '@nestling/transport';
import { CliTransport } from '@nestling/transport.cli';

/**
 * Standalone-путь CLI: те же примитивы, что и под `App`.
 *
 * Декларации deps-free, поэтому `makeDispatch` принимает их как есть —
 * гасить нечего. Что значит «выйти в эфир» для командной строки, решает
 * корень: аргументы есть — single-shot, нет — REPL.
 */
const argv = process.argv.slice(2);

const cli = new CliTransport({
  mode: argv.length > 0 ? 'argv' : 'repl',
  argv,
});

const dispatch = makeDispatch([Help, ProcessStdin]);

/** Канал остановки: взвод отменяет выполняющиеся команды кооперативно */
const shutdown = new AbortController();

async function main() {
  console.log(
    argv.length > 0
      ? '🚀 Nestling CLI Transport Example\n'
      : '🚀 Nestling CLI Transport Example (REPL Mode)\n\nType commands or "exit" to quit\n',
  );

  // До этого момента исполнимых ручек у транспорта нет вовсе
  await cli.serve(dispatch, shutdown.signal);
  await cli.close();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
