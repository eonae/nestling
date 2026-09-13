/* eslint-disable unicorn/no-process-exit -- это и есть CLI */
/* eslint-disable no-console -- вход печатает подсказку и отказ */

import {
  CreateUser,
  ExportUsers,
  Help,
  ImportUsers,
  ListUsers,
} from './commands/index.js';

import { makeDispatch } from '@nestlingjs/app';
import { CliTransport } from '@nestlingjs/transport.cli';

/**
 * CLI без `assemble`: аргументы есть — выполняется одна команда,
 * аргументов нет — открывается REPL.
 *
 * Контейнер здесь не нужен: команды зависят только от клиента сервиса, а
 * он — обычное значение.
 */
const argv = process.argv.slice(2);

const cli = new CliTransport({
  mode: argv.length > 0 ? 'argv' : 'repl',
  argv,
});

const dispatch = makeDispatch([
  Help,
  CreateUser,
  ListUsers,
  ExportUsers,
  ImportUsers,
]);

// Общий сигнал остановки: взвод отменяет выполняющиеся команды
const shutdown = new AbortController();

async function main(): Promise<void> {
  if (argv.length === 0) {
    console.log('REPL mode: type a command or "exit"');
  }

  await cli.serve(dispatch, shutdown.signal);
  await cli.close();
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
