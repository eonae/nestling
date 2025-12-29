/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */

import { fromScratch } from '@nestling/models';
import { App, CliTransport } from '@nestling/transport';
import { z } from 'zod';

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
    const payload = ctx.payload as {
      args: string[];
      enthusiastic?: boolean;
    };
    const name = payload.args[0] || 'World';
    const enthusiastic = payload.enthusiastic;

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

// calc - калькулятор (старый подход без схем)
app.registerHandler({
  transport: 'cli',
  command: 'calc',
  handler: async (ctx) => {
    const payload = ctx.payload as {
      args: string[];
      op?: string;
    };
    const operation = payload.op;
    const a = Number.parseFloat(payload.args[0] || '0');
    const b = Number.parseFloat(payload.args[1] || '0');

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
    const payload = ctx.payload as {
      args: string[];
      uppercase?: boolean;
    };
    const message = payload.args.join(' ');
    const uppercase = payload.uppercase;

    const output = uppercase ? message.toUpperCase() : message;
    console.log(output);

    return {
      status: 0,
      value: { message: output },
      meta: {},
    };
  },
});

// Schema-driven примеры

// Схема для калькулятора со строгой типизацией
const CalcSchema = fromScratch().defineModel(
  z.object({
    a: z.number().describe('Первое число'),
    b: z.number().describe('Второе число'),
    operation: z
      .enum(['add', 'sub', 'mul', 'div', '+', '-', '*', '/'])
      .describe('Операция: add/sub/mul/div или +/-/*//'),
  }),
);

// calc-schema - калькулятор со схемой
app.registerHandler({
  transport: 'cli',
  command: 'calc-schema',
  handler: async (ctx) => {
    // Извлекаем данные из payload
    const payload = ctx.payload as {
      args: string[];
      op?: string;
    };

    // Преобразуем CLI input в формат для схемы
    const input = {
      a: Number.parseFloat(payload.args[0] || '0'),
      b: Number.parseFloat(payload.args[1] || '0'),
      operation: payload.op || 'add',
    };

    // Валидируем через схему
    const validated = CalcSchema.parse(input);
    const { a: validatedA, b: validatedB, operation: validatedOp } = validated;

    // input строго типизирован после валидации!
    let result: number;
    let op: string;

    switch (validatedOp) {
      case 'add':
      case '+': {
        result = validatedA + validatedB;
        op = '+';
        break;
      }
      case 'sub':
      case '-': {
        result = validatedA - validatedB;
        op = '-';
        break;
      }
      case 'mul':
      case '*': {
        result = validatedA * validatedB;
        op = '*';
        break;
      }
      case 'div':
      case '/': {
        if (validatedB === 0) {
          console.error('Error: Division by zero');
          return {
            status: 1,
            value: { error: 'Division by zero' },
            meta: {},
          };
        }
        result = validatedA / validatedB;
        op = '/';
        break;
      }
      default: {
        console.error('Error: Unknown operation');
        return {
          status: 1,
          value: { error: 'Unknown operation' },
          meta: {},
        };
      }
    }

    console.log(`Result: ${validatedA} ${op} ${validatedB} = ${result}`);

    return {
      status: 0,
      value: { a: validatedA, b: validatedB, operation: op, result },
      meta: {},
    };
  },
});

// Схема для команды greet
const GreetSchema = fromScratch().defineModel(
  z.object({
    name: z.string().min(1).max(50).describe('Имя для приветствия'),
    enthusiastic: z.boolean().optional().describe('Энтузиастичное приветствие'),
  }),
);

// greet-schema - приветствие со схемой
app.registerHandler({
  transport: 'cli',
  command: 'greet-schema',
  handler: async (ctx) => {
    const payload = ctx.payload as {
      args: string[];
      enthusiastic?: boolean;
    };

    // Преобразуем CLI input
    const input = {
      name: payload.args[0] || 'World',
      enthusiastic: Boolean(payload.enthusiastic),
    };

    // Валидируем
    const validated = GreetSchema.parse(input);
    const { name, enthusiastic = false } = validated;

    const greeting = enthusiastic ? `Hello, ${name}!!!` : `Hello, ${name}!`;

    console.log(greeting);

    return {
      status: 0,
      value: { greeting },
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
    console.log('  greet-schema [name] [--enthusiastic]');
    console.log('    Greet someone (with schema validation)');
    console.log('    Example: yarn start greet-schema Alice --enthusiastic');
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
    console.log('  calc-schema <a> <b> --op <operation>');
    console.log('    Calculate a math operation (with schema validation)');
    console.log('    Operations: add, sub, mul, div (or +, -, *, /)');
    console.log('    Example: yarn start calc-schema 10 5 --op add');
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
