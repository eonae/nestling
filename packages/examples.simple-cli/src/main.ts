/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */

import { Greet, Help, ProcessStdin } from './commands';

import { makeDispatch } from '@nestling/transport';
import { CliTransport } from '@nestling/transport.cli';

/**
 * CLI без `assemble`: аргументы есть — выполняется одна команда, аргументов
 * нет — открывается REPL.
 */
const argv = process.argv.slice(2);

const cli = new CliTransport({
  mode: argv.length > 0 ? 'argv' : 'repl',
  argv,
});

const dispatch = makeDispatch([Help, Greet, ProcessStdin]);

// Общий сигнал остановки: взвод отменяет выполняющиеся команды
const shutdown = new AbortController();

async function main() {
  if (argv.length === 0) {
    console.log('REPL mode: type a command or "exit"');
  }

  await cli.serve(dispatch, shutdown.signal);
  await cli.close();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
