/* eslint-disable no-console */
import * as readline from 'node:readline';

import type { Schema } from '@common/misc';
import type { InjectionToken } from '@nestling/container';
import type {
  AnyEndpointDefinition,
  AnyFailDefinition,
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
  EndpointMeta,
  FailsOf,
  HandlerClass,
  HandlerFactory,
  HandlerFn,
  Pipeline,
  Raw,
  ResponseContext,
  TransportCapabilities,
  UnknownFailInfo,
  ValidateOutputForm,
} from '@nestling/pipeline';
import {
  assertFormsSupported,
  bindInputStream,
  describeForm,
  isAsyncIterable,
  makeEmptyContext,
  makeEndpoint,
  parsePayload,
  TransportClosingError,
} from '@nestling/pipeline';
import { untilAborted } from '@nestling/streams';
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
  E extends readonly AnyFailDefinition[] = [],
> {
  /** Имя команды; оно же паттерн ручки */
  command: string;

  /** Форма io для input: значение или `stream(...)` */
  input?: I;

  /** Форма io для output (см. `ValidateOutputForm`) */
  output?: O & ValidateOutputForm<O>;

  /**
   * Объявленные отказы команды. Транспорт поле не интерпретирует — только
   * пробрасывает в `makeEndpoint` (см. `httpEndpoint`).
   */
  errors?: E;

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
  E extends readonly AnyFailDefinition[] = [],
>(
  declaration: CliEndpointDictionary<I, O, P, PN, E> & {
    deps?: undefined;
    handle: HandlerFn<I, O, P, FailsOf<E>>;
  },
): EndpointDefinition<I, O, P, PN>;
export function cliEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
  D extends InjectionToken[] = InjectionToken[],
>(
  declaration: CliEndpointDictionary<I, O, P, PN, E> & {
    deps: [...D];
    handle: HandlerFactory<D, I, O, P, FailsOf<E>>;
  },
): EndpointDefinition<I, O, P, PN | D[number]>;
export function cliEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
  C extends HandlerClass<I, O, P, FailsOf<E>> = HandlerClass<
    I,
    O,
    P,
    FailsOf<E>
  >,
>(
  declaration: CliEndpointDictionary<I, O, P, PN, E> & {
    deps?: undefined;
    handle: C;
  },
): EndpointDefinition<I, O, P, PN | C>;
export function cliEndpoint(
  declaration: CliEndpointDictionary<
    any,
    any,
    any,
    unknown,
    readonly AnyFailDefinition[]
  > & {
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
 * Опции CLI транспорта
 */
export interface CliTransportOptions {
  /**
   * Диагностический хук стража границы: получает оригинал отказа,
   * снятого нормализацией в `UnknownError`. Не задан — рантайм пишет в
   * `console.error`.
   */
  onUnknownFail?: (info: UnknownFailInfo) => void;
}

/**
 * Формы io, которые умеет CLI.
 *
 * `events` нет: у команды нет открытого соединения, дисконнект которого
 * был бы нормальным завершением. `multipart` нет: файлы приходят путями в
 * аргументах, а не полями формы.
 */
const CLI_CAPABILITIES: TransportCapabilities = {
  input: new Set(['value', 'stream']),
  output: new Set(['value', 'stream']),
};

/**
 * CLI транспорт
 */
export class CliTransport implements ITransport {
  /** Способности транспорта: читает `assertFormsSupported` на сборке */
  readonly capabilities: TransportCapabilities = CLI_CAPABILITIES;

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

  constructor(
    private readonly defaultPipeline?: Pipeline<any, any, never>,
    private readonly options: CliTransportOptions = {},
  ) {}

  /**
   * Регистрирует handler через конфигурацию
   */
  endpoint<
    I extends AnyPayload = AnyPayload,
    O extends AnyOutput = AnyOutput,
    P extends AnyInput = AnyInput,
  >(definition: EndpointDefinition<I, O, P, never>): void {
    // Та же проверка, что делает `App`: и standalone-путь под гарантией
    assertFormsSupported(definition, this.capabilities);
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

    // Форма input определяет, как читается вход команды
    const inputForm = describeForm(definition.input);
    const outputForm = describeForm(definition.output);

    let payload: unknown;
    let streamSource: AsyncIterable<unknown> | undefined;

    switch (inputForm.kind) {
      case 'stream': {
        // Поток stdin; поэлементную валидацию навесит ядро
        streamSource = this.streamStdin(inputForm.leaf === 'binary');
        break;
      }
      default: {
        // Обычная схема, примитив или отсутствие input — парсим только args
        const rawPayload = {
          args: input.args,
          ...input.options,
        };

        payload =
          inputForm.leaf &&
          inputForm.leaf !== 'binary' &&
          inputForm.leaf !== 'text'
            ? parsePayload(inputForm.leaf as Schema, {
                payload: rawPayload,
                metadata: {},
              })
            : rawPayload;
      }
    }

    // Получаем pipeline из definition или используем default
    const pipeline = definition.pipeline ?? this.defaultPipeline;

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
      // Объявленные отказы доезжают до стража только так: декларация →
      // транспорт → контекст, без глобального реестра.
      errors: definition.errors,
    };

    const ctx = makeEmptyContext(
      raw,
      endpointMeta,
      this.closeController.signal,
    );

    if (streamSource) {
      // Обёртка ядра доступна только теперь: счётчики живут в контексте
      raw.payload = bindInputStream(inputForm, streamSource, ctx);
    }

    const response = pipeline
      ? // CLI — локальный инструмент: детали ошибок (stack) в терминале полезны
        await pipeline.executeWithHandler(definition.handle, ctx, {
          exposeErrorDetails: true,
          onUnknownFail: this.options.onUnknownFail,
        })
      : ({
          isSuccess: true,
          status: 'OK',
          value: await definition.handle(raw.payload, {
            signal: this.closeController.signal,
            fail: (error: never): never => {
              throw error;
            },
          }),
        } as ResponseContext);

    // Потоковый выход: NDJSON в stdout, завершение по концу потока и по
    // сигналу. Итератор обязан быть либо потреблён, либо закрыт — иначе
    // отложенные `.finally`-юниты не выполнятся.
    if (
      outputForm.kind === 'stream' &&
      response.isSuccess &&
      isAsyncIterable(response.value)
    ) {
      await this.writeNdjson(response.value);
      return { ...response, value: null };
    }

    return response;
  }

  /**
   * Стримит stdin как AsyncIterable.
   *
   * Форма `stream('binary')` отдаёт чанки как есть, схема-лист —
   * NDJSON-строки: ядро валидирует их поэлементно.
   */
  private async *streamStdin(binary: boolean): AsyncIterableIterator<unknown> {
    if (process.stdin.isTTY) {
      return; // Нет данных в stdin
    }

    if (binary) {
      yield* process.stdin;
      return;
    }

    let buffer = '';
    for await (const chunk of process.stdin) {
      buffer += (chunk as Buffer).toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          yield JSON.parse(trimmed);
        }
      }
    }

    const tail = buffer.trim();
    if (tail) {
      yield JSON.parse(tail);
    }
  }

  /** NDJSON в stdout: по одному JSON-объекту на строку */
  private async writeNdjson(source: AsyncIterable<unknown>): Promise<void> {
    for await (const item of untilAborted(
      source,
      this.closeController.signal,
    )) {
      const line =
        typeof item === 'string' ? item : `${JSON.stringify(item)}\n`;
      process.stdout.write(line);
    }
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
