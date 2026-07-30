/* eslint-disable no-console */
import * as readline from 'node:readline';
import type { Readable } from 'node:stream';

import type { Schema } from '@common/misc';
import type { InjectionToken } from '@nestling/container';
import type {
  AnyEndpointDefinition,
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
  EndpointMeta,
  FilePart,
  HandlerClass,
  HandlerFactory,
  HandlerFn,
  Pipeline,
  Raw,
  ResponseContext,
} from '@nestling/pipeline';
import {
  analyzePayload,
  makeEmptyContext,
  makeEndpoint,
  parsePayload,
  TransportClosingError,
} from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';

/**
 * Транспортный словарь CLI-декларации.
 *
 * Легален и типизирован только здесь; пайплайн и хендлер остаются
 * транспорт-слепыми. Стратегия сбора недостающего input (`missing:
 * 'prompt'`) — политика биндинга, приезжает отдельной работой.
 */
export interface CliEndpointDictionary<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
> {
  /** Имя команды; оно же паттерн ручки */
  command: string;

  /** Schema или модификатор для input */
  input?: I;

  /** Конфигурация выходных данных */
  output?: O;

  /**
   * Pipeline для этой команды. Классы-юниты допустимы: они попадают в
   * `TNeeds` декларации и гасятся вместе с `deps`.
   */
  pipeline?: Pipeline<AnyInput, P, PN>;
}

/**
 * Конструктор CLI-деклараций.
 *
 * Тонкая надстройка над kernel-примитивом `makeEndpoint`: `transport` —
 * `'cli'`, `pattern` — имя команды. Общая машинерия деклараций (`deps`,
 * три формы `handle`, `resolve`, бренд) живёт в `makeEndpoint`.
 *
 * @example
 * ```typescript
 * export const ProcessStdin = cliEndpoint({
 *   command: 'process-stdin',
 *   input: stream('binary'),
 *   output: ProcessStdinResponse,
 *   pipeline: makePipeline(),
 *   handle: async (chunks) => summarize(chunks),
 * });
 * ```
 *
 * @throws {Error} Пустое имя команды
 */
export function cliEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
>(
  declaration: CliEndpointDictionary<I, O, P, PN> & {
    deps?: undefined;
    handle: HandlerFn<I, O, P>;
  },
): EndpointDefinition<I, O, P, PN>;
export function cliEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  D extends InjectionToken[] = InjectionToken[],
>(
  declaration: CliEndpointDictionary<I, O, P, PN> & {
    deps: [...D];
    handle: HandlerFactory<D, I, O, P>;
  },
): EndpointDefinition<I, O, P, PN | D[number]>;
export function cliEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  C extends HandlerClass<I, O, P> = HandlerClass<I, O, P>,
>(
  declaration: CliEndpointDictionary<I, O, P, PN> & {
    deps?: undefined;
    handle: C;
  },
): EndpointDefinition<I, O, P, PN | C>;
export function cliEndpoint(
  declaration: CliEndpointDictionary<any, any, any, unknown> & {
    deps?: InjectionToken[];
    handle: unknown;
  },
): AnyEndpointDefinition {
  const { command, ...rest } = declaration;

  if (typeof command !== 'string' || command.length === 0) {
    throw new Error("cliEndpoint({ … }): 'command' must be a non-empty name.");
  }

  return (makeEndpoint as (options: unknown) => AnyEndpointDefinition)({
    ...rest,
    transport: 'cli',
    pattern: command,
  });
}

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
export class CliTransport implements ITransport {
  private readonly handlers = new Map<
    string,
    EndpointDefinition<any, any, any>
  >();
  private repl?: readline.Interface;

  /**
   * Transport-level канал отмены: сигнал попадает в meta каждой команды
   * и взводится в `close()` — выполняющиеся команды могут завершиться
   * кооперативно.
   */
  private readonly closeController = new AbortController();

  constructor(private readonly defaultPipeline?: Pipeline<any, any, never>) {}

  /**
   * Регистрирует handler через конфигурацию
   */
  endpoint<
    I extends AnyPayload = AnyPayload,
    O extends AnyOutput = AnyOutput,
    P extends AnyInput = AnyInput,
  >(definition: EndpointDefinition<I, O, P, never>): void {
    this.handlers.set(definition.pattern, definition);
  }

  /**
   * Выполняет команду
   */
  async execute(input: CliInput): Promise<ResponseContext> {
    const definition = this.handlers.get(input.command);
    if (!definition) {
      throw new Error(`Command "${input.command}" not found`);
    }

    // Анализируем input конфигурацию
    const inputConfig = analyzePayload(definition.input);

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

    // Получаем pipeline из definition или используем default
    const pipeline = definition.pipeline ?? this.defaultPipeline;

    if (pipeline) {
      // Новая архитектура с pipeline
      const raw: Raw = {
        transport: 'cli',
        pattern: input.command,
        payload,
        attributes: {
          command: input.command,
          args: input.args,
          options: input.options,
        },
      };

      const endpointMeta: EndpointMeta = {
        transport: 'cli',
        pattern: definition.pattern,
        input: definition.input,
        output: definition.output,
      };

      const ctx = makeEmptyContext(
        raw,
        endpointMeta,
        this.closeController.signal,
      );

      // CLI — локальный инструмент: детали ошибок (stack) в терминале полезны.
      return pipeline.executeWithHandler(definition.handle, ctx, {
        exposeErrorDetails: true,
      });
    } else {
      // Fallback без pipeline - прямой вызов handler
      const result = await definition.handle(payload, {
        signal: this.closeController.signal,
      });
      return {
        isSuccess: true,
        status: 'OK',
        value: result,
      };
    }
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

          if (!result.isSuccess) {
            process.exitCode = 1;
          }

          if (result.value !== null && result.value !== undefined) {
            console.log(JSON.stringify(result.value, null, 2));
          }
        } catch (error) {
          console.error(
            'Error:',
            error instanceof Error ? error.message : error,
          );
          process.exitCode = 1;
        }

        this.repl?.prompt();
      });

      this.repl?.on('close', () => {
        resolve();
      });
    });
  }

  /**
   * Останавливает REPL, предварительно взводя сигнал отмены
   * выполняющихся команд
   */
  async close(): Promise<void> {
    this.closeController.abort(new TransportClosingError());

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
