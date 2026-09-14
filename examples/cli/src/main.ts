/* eslint-disable unicorn/no-process-exit -- это и есть CLI */

import {
  CreateUser,
  ExportUsers,
  Help,
  ImportUsers,
  ListUsers,
} from './commands/index.js';

import { makeConsoleLogger, makeDispatch } from '@nestlingjs/app';
import { CliTransport } from '@nestlingjs/transport.cli';

/**
 * CLI без `build`: аргументы есть — выполняется одна команда,
 * аргументов нет — открывается REPL.
 *
 * Контейнер здесь не нужен: команды зависят только от клиента сервиса, а
 * он — обычное значение.
 */
const commandLine = process.argv.slice(2);

/**
 * Логгер входа: подсказка и фатальная ошибка — записи, а не результат
 * команды, поэтому уходят в `stderr`. На `stdout` остаётся то, что
 * напечатал транспорт.
 */
const logger = makeConsoleLogger();

const cli = new CliTransport({
  mode: commandLine.length > 0 ? 'argv' : 'repl',
  argv: commandLine,
});

const dispatch = makeDispatch(
  [Help, CreateUser, ListUsers, ExportUsers, ImportUsers],
  { logger },
);

// Общий сигнал остановки: взвод отменяет выполняющиеся команды
const shutdown = new AbortController();

async function main(): Promise<void> {
  if (commandLine.length === 0) {
    logger.info('REPL mode: type a command or "exit"');
  }

  await cli.serve(dispatch, shutdown.signal);
  await cli.close();
}

main().catch((error: unknown) => {
  logger.error('fatal error', { err: error });
  process.exit(1);
});
