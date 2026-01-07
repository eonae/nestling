/* eslint-disable no-console */
import * as readline from 'node:readline';
import type { Readable } from 'node:stream';

import type { Optional, Schema } from '@common/misc';
import type {
  FilePart,
  HandlerConfig,
  HandlerFn,
  Input,
  Output,
  RequestContext,
  ResponseContext,
} from '@nestling/pipeline';
import {
  analyzeInput,
  parseMetadata,
  parsePayload,
  Pipeline,
} from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';
/**
 * Входные данные для CLI транспорта
 */
export interface CliInput {
  command: string;
  args: string[];
  options: Record<string, unknown>;
}

/**
 * CLI-специфичная конфигурация handler'а
 */
export interface CliHandlerConfig<
  I extends Input = Schema,
  O extends Output = Schema,
  M extends Optional<Schema> = Optional<Schema>,
> extends HandlerConfig<I, O, M> {
  command: string;
}

/**
 * CLI транспорт
 */
export class CliTransport implements ITransport {
  private readonly pipeline: Pipeline;
  private readonly handlers = new Map<
    string,
    { handler: HandlerFn<any, any, any>; config: HandlerConfig<any, any, any> }
  >();
  private repl?: readline.Interface;

  constructor() {
    this.pipeline = new Pipeline();
  }

  /**
   * Регистрирует handler через конфигурацию
   */
  endpoint<
    I extends Input = Schema,
    O extends Output = Schema,
    M extends Optional<Schema> = Optional<Schema>,
  >(config: CliHandlerConfig<I, O, M>): void {
    const { handle, command } = config;

    if (!command) {
      throw new Error('CLI handler config must include command');
    }

    this.handlers.set(String(command), { handler: handle, config });
  }

  /**
   * Регистрирует обработчик для команды (для обратной совместимости)
   */
  command(command: string, handler: HandlerFn<any, any, any>): void {
    this.handlers.set(command, {
      handler,
      config: { transport: 'cli', pattern: command, handle: handler },
    });
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
    const handlerData = this.handlers.get(input.command);
    if (!handlerData) {
      throw new Error(`Command "${input.command}" not found`);
    }

    const { handler, config } = handlerData;

    // Анализируем input конфигурацию
    const inputConfig = analyzeInput(config.input);

    let payload: unknown;

    // Парсим входные данные согласно типу модификатора
    switch (inputConfig.type) {
      case 'stream': {
        // Streaming данные из stdin
        payload = this.streamStdin();

        break;
      }
      case 'withFiles': {
        // Args + stdin как file
        const data = parsePayload(inputConfig.schema as Schema, {
          payload: {
            args: input.args,
            ...input.options,
          },
          metadata: {},
        });
        const files = await this.parseStdin();
        payload = { data, files };

        break;
      }
      case 'files': {
        // Только stdin как file
        const files = await this.parseStdin();
        payload = files;

        break;
      }
      case 'primitive': {
        // Примитивные типы (binary/text) не поддерживаются в CLI
        throw new Error(
          `Primitive input type "${inputConfig.primitive}" is not supported in CLI transport`,
        );
      }
      default: {
        // Обычная схема или undefined - парсим только args
        const rawPayload = {
          args: input.args,
          ...input.options,
        };

        payload = inputConfig.schema
          ? parsePayload(inputConfig.schema as Schema, {
              payload: rawPayload,
              metadata: {},
            })
          : rawPayload;
      }
    }

    // Создаем RequestContext
    const requestContext: RequestContext = {
      transport: 'cli',
      pattern: `${input.command}`,
      payload,
      metadata: {
        command: input.command,
        args: input.args,
        options: input.options,
      },
    };

    // Валидируем metadata если нужно
    if (config.metadata) {
      const inputSources = {
        payload: payload as Record<string, unknown>,
        metadata: requestContext.metadata as Record<string, unknown>,
      };

      requestContext.metadata = parseMetadata(config.metadata, inputSources);
    }

    // Выполняем пайплайн с handler
    return this.pipeline.executeWithHandler(handler, requestContext);
  }

  /**
   * Стримит stdin как AsyncIterator
   */
  private async *streamStdin(): AsyncIterator<Buffer | string> {
    if (process.stdin.isTTY) {
      return; // Нет данных в stdin
    }

    for await (const chunk of process.stdin) {
      yield chunk;
    }
  }

  /**
   * Парсит stdin как FilePart
   */
  private async parseStdin(): Promise<FilePart[]> {
    if (process.stdin.isTTY) {
      return [];
    }

    // Создаем FilePart из stdin
    return [
      {
        field: 'stdin',
        filename: 'stdin',
        mime: 'application/octet-stream',
        stream: process.stdin as Readable,
      },
    ];
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
