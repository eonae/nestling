/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */

import { Help, ProcessStdin } from './endpoints';

import type { EmptyInput, PreUnitFn } from '@nestling/pipeline';
import { makePipeline } from '@nestling/pipeline';
import { CliTransport } from '@nestling/transport.cli';

// Добавляет timestamp в input
const withTiming: PreUnitFn<EmptyInput, { timestamp: number }> = async () => ({
  timestamp: Date.now(),
});

// Создаем CLI транспорт с pipeline
const pipeline = makePipeline().pre(withTiming);

const cli = new CliTransport(pipeline);

// ============================================================
// Регистрируем декларации: deps-free — идут в endpoint() как есть
// ============================================================

cli.endpoint(Help);
cli.endpoint(ProcessStdin);

// ============================================================
// Парсинг аргументов командной строки
// ============================================================

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
      const result = await cli.execute({
        command,
        args: commandArgs,
        options,
      });

      // Статус — семантика, а не число: CLI печатает его как есть.
      // Успех уходит в stdout, отказ — в stderr с ненулевым кодом выхода;
      // тело отказа несёт машинный `code` объявленного определения.
      if (result.isSuccess) {
        console.log(JSON.stringify(result.value, null, 2));
      } else {
        console.error(`${result.status}:`, JSON.stringify(result.value));
        process.exit(1);
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
      await cli.listen();
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
