/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */

import {
  CalcHandler,
  GreetHandler,
  InfoHandler,
} from './handlers.class/index.js';
import { Help } from './handlers.functional/help.handler.js';
import { LoggingMiddleware, TimingMiddleware } from './middleware/index.js';

import { App } from '@nestling/app';
import { CliTransport } from '@nestling/transport.cli';

// Создаем CLI транспорт
const cliTransport = new CliTransport();

// Добавляем middleware для логирования (функциональный стиль)
cliTransport.use(LoggingMiddleware);

// Добавляем middleware для измерения времени (классовый стиль)
cliTransport.use(TimingMiddleware);

// Создаем App с транспортами
const app = new App({
  cli: cliTransport,
});

// ============================================================
// ПОДХОД 1: app.registerHandler (функциональный стиль)
// ============================================================

app.registerHandler(Help);

// ============================================================
// ПОДХОД 2: @Handler (классовый стиль)
// ============================================================

app.registerHandler(InfoHandler);
app.registerHandler(CalcHandler);
app.registerHandler(GreetHandler);

// ============================================================
// Команда help (inline для простоты)
// ============================================================

// Парсинг аргументов командной строки
function parseArgs(): {
  command: string;
  args: string[];
  options: Record<string, unknown>;
} {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    return { command: 'help', args: [], options: {} };
  }

  const command = args[0];
  const options: Record<string, unknown> = {};
  const commandArgs: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('--')) {
        options[key] = nextArg;
        i++; // Skip next arg as it's a value
      } else {
        options[key] = true; // Flag without value
      }
    } else {
      commandArgs.push(arg);
    }
  }

  return { command, args: commandArgs, options };
}

// Запуск CLI
async function main() {
  const args = process.argv.slice(2);

  // Если есть аргументы - выполняем команду и выходим (single-shot режим)
  if (args.length > 0) {
    const { command, args: commandArgs, options } = parseArgs();

    console.log('🚀 Nestling CLI Transport Example\n');

    try {
      const result = await cliTransport.execute({
        command,
        args: commandArgs,
        options,
      });

      if (result.status && result.status !== 0) {
        process.exit(result.status);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        console.error(`Error: Unknown command "${command}"`);
        console.error('Run "yarn start help" to see available commands');
        process.exit(1);
      }

      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  } else {
    // Если аргументов нет - запускаем REPL режим
    console.log('🚀 Nestling CLI Transport Example (REPL Mode)\n');
    console.log('Type commands or "exit" to quit\n');

    try {
      await app.listen();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
