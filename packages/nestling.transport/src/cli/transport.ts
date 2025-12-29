/* eslint-disable no-console */
import * as readline from 'node:readline';

import type {
  Handler,
  HandlerConfig,
  RequestContext,
  ResponseContext,
  Transport,
} from '../core/interfaces.js';
import { Pipeline } from '../core/pipeline.js';

/**
 * Входные данные для CLI транспорта
 */
export interface CliInput {
  command: string;
  args: string[];
  options: Record<string, unknown>;
}

/**
 * CLI транспорт
 */
export class CliTransport implements Transport {
  private readonly pipeline: Pipeline;
  private readonly handlers = new Map<string, Handler>();
  private repl?: readline.Interface;

  constructor() {
    this.pipeline = new Pipeline();
  }

  /**
   * Регистрирует handler через конфигурацию
   */
  registerHandler(config: HandlerConfig): void {
    const { handler, command } = config;

    if (!command) {
      throw new Error('CLI handler config must include command');
    }

    this.handlers.set(String(command), handler);
  }

  /**
   * Регистрирует обработчик для команды (для обратной совместимости)
   */
  command(command: string, handler: Handler): void {
    this.handlers.set(command, handler);
  }

  /**
   * Добавляет middleware в пайплайн
   */
  use(middleware: Parameters<Pipeline['use']>[0]): void {
    this.pipeline.use(middleware);
  }

  /**
   * Выполняет команду
   */
  async execute(input: CliInput): Promise<ResponseContext> {
    const handler = this.handlers.get(input.command);
    if (!handler) {
      throw new Error(`Command "${input.command}" not found`);
    }

    // Создаем RequestContext
    const requestContext: RequestContext = {
      transport: 'cli',
      method: input.command,
      path: `/${input.command}`,
      payload: {
        args: input.args,
        ...input.options,
      },
      metadata: {
        command: input.command,
        args: input.args,
        options: input.options,
      },
    };

    // Устанавливаем handler в пайплайн
    this.pipeline.setHandler(handler);

    // Выполняем пайплайн
    return this.pipeline.execute(requestContext);
  }

  /**
   * Запускает REPL для чтения команд из stdin
   */
  async listen(): Promise<void> {
    if (this.repl) {
      throw new Error('REPL is already listening');
    }

    this.repl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });

    this.repl.prompt();

    return new Promise((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.repl!.on('line', async (line: string) => {
        const trimmed = line.trim();

        if (trimmed === 'exit' || trimmed === 'quit') {
          this.repl?.close();
          resolve();
          return;
        }

        if (trimmed === '') {
          this.repl?.prompt();
          return;
        }

        try {
          const input = this.parseCommand(trimmed);
          const result = await this.execute(input);

          if (result.value !== undefined) {
            console.log(JSON.stringify(result.value, null, 2));
          }
        } catch (error) {
          console.error(
            'Error:',
            error instanceof Error ? error.message : error,
          );
        }

        this.repl?.prompt();
      });

      this.repl?.on('close', () => {
        resolve();
      });
    });
  }

  /**
   * Останавливает REPL
   */
  async close(): Promise<void> {
    if (this.repl) {
      this.repl.close();
      this.repl = undefined;
    }
  }

  /**
   * Парсит строку команды в CliInput
   */
  private parseCommand(line: string): CliInput {
    const args = line.split(/\s+/);
    const command = args[0] || '';
    const commandArgs: string[] = [];
    const options: Record<string, unknown> = {};

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
}
