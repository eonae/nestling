/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */

import { App, CliTransport } from '@nestling/transport';

// Создаем CLI транспорт
const cliTransport = new CliTransport();

// Добавляем middleware для логирования
cliTransport.use(async (ctx, next) => {
  console.log(`\n→ Executing command: ${ctx.method}`);
  const start = Date.now();
  const response = await next();
  const duration = Date.now() - start;
  console.log(`← Command completed in ${duration}ms\n`);
  return response;
});

// Создаем App с транспортами
const app = new App({
  cli: cliTransport,
});

// Регистрируем команды

// greet - приветствие
app.registerHandler({
  transport: 'cli',
  command: 'greet',
  handler: async (ctx) => {
    const body = ctx.body as {
      args: string[];
      options: Record<string, unknown>;
    };
    const name = body.args[0] || 'World';
    const enthusiastic = body.options.enthusiastic as boolean | undefined;

    const greeting = enthusiastic ? `Hello, ${name}!!!` : `Hello, ${name}!`;

    console.log(greeting);

    return {
      status: 0,
      value: { greeting },
      meta: {},
    };
  },
});

// info - информация о системе
app.registerHandler({
  transport: 'cli',
  command: 'info',
  handler: async () => {
    const info = {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      cwd: process.cwd(),
      uptime: `${Math.floor(process.uptime())}s`,
      memory: {
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      },
    };

    console.log('System Information:');
    console.log(`  Platform: ${info.platform}`);
    console.log(`  Architecture: ${info.arch}`);
    console.log(`  Node Version: ${info.nodeVersion}`);
    console.log(`  Current Directory: ${info.cwd}`);
    console.log(`  Process Uptime: ${info.uptime}`);
    console.log(`  Heap Used: ${info.memory.heapUsed}`);
    console.log(`  Heap Total: ${info.memory.heapTotal}`);

    return {
      status: 0,
      value: info,
      meta: {},
    };
  },
});

// calc - калькулятор
app.registerHandler({
  transport: 'cli',
  command: 'calc',
  handler: async (ctx) => {
    const body = ctx.body as {
      args: string[];
      options: Record<string, unknown>;
    };
    const operation = body.options.op as string | undefined;
    const a = Number.parseFloat(body.args[0] || '0');
    const b = Number.parseFloat(body.args[1] || '0');

    let result: number;
    let op: string;

    switch (operation) {
      case 'add':
      case '+': {
        result = a + b;
        op = '+';
        break;
      }
      case 'sub':
      case '-': {
        result = a - b;
        op = '-';
        break;
      }
      case 'mul':
      case '*': {
        result = a * b;
        op = '*';
        break;
      }
      case 'div':
      case '/': {
        if (b === 0) {
          console.error('Error: Division by zero');
          return {
            status: 1,
            value: { error: 'Division by zero' },
            meta: {},
          };
        }
        result = a / b;
        op = '/';
        break;
      }
      default: {
        console.error('Error: Unknown operation. Use --op add|sub|mul|div');
        return {
          status: 1,
          value: { error: 'Unknown operation' },
          meta: {},
        };
      }
    }

    console.log(`Result: ${a} ${op} ${b} = ${result}`);

    return {
      status: 0,
      value: { a, b, operation: op, result },
      meta: {},
    };
  },
});

// echo - эхо аргументов
app.registerHandler({
  transport: 'cli',
  command: 'echo',
  handler: async (ctx) => {
    const body = ctx.body as {
      args: string[];
      options: Record<string, unknown>;
    };
    const message = body.args.join(' ');
    const uppercase = body.options.uppercase as boolean | undefined;

    const output = uppercase ? message.toUpperCase() : message;
    console.log(output);

    return {
      status: 0,
      value: { message: output },
      meta: {},
    };
  },
});

// help - справка
app.registerHandler({
  transport: 'cli',
  command: 'help',
  handler: async () => {
    console.log('Available commands:');
    console.log('');
    console.log('  greet [name] [--enthusiastic]');
    console.log('    Greet someone');
    console.log('    Example: yarn start greet Alice --enthusiastic');
    console.log('');
    console.log('  info');
    console.log('    Show system information');
    console.log('    Example: yarn start info');
    console.log('');
    console.log('  calc <a> <b> --op <operation>');
    console.log('    Calculate a math operation');
    console.log('    Operations: add, sub, mul, div (or +, -, *, /)');
    console.log('    Example: yarn start calc 10 5 --op add');
    console.log('');
    console.log('  echo <text> [--uppercase]');
    console.log('    Echo text back');
    console.log('    Example: yarn start echo "Hello World" --uppercase');
    console.log('');
    console.log('  help');
    console.log('    Show this help message');
    console.log('');

    return {
      status: 0,
      value: { message: 'Help displayed' },
      meta: {},
    };
  },
});

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
