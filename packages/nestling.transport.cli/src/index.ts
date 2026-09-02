/* eslint-disable no-console */
import * as readline from 'node:readline';

import type { InjectionToken } from '@nestling/container';
import { factoryProvider, makeTokenFamily } from '@nestling/container';
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
  TransportClosingError,
} from '@nestling/pipeline';
import { untilAborted } from '@nestling/streams';
import type {
  Dispatch,
  ITransport,
  RouteDeclaration,
  TransportDeclaration,
} from '@nestling/transport';
import {
  DEFAULT_INSTANCE,
  makeTransportDeclaration,
  transportNameOf,
} from '@nestling/transport';

/**
 * Семейство токенов CLI-транспорта: один член на экземпляр.
 *
 * Им ссылается на транспорт каждая `cliEndpoint`-декларация; `App` берёт по
 * нему инстанс из графа. Декларация выбирает экземпляр через `on:`; без
 * него это `'default'`.
 */
export const CliTransport$ = makeTokenFamily<ITransport, [instance: string]>(
  'transport:cli',
);

/** Короткое имя транспорта (`'cli'`) — то же, что читают слои пайплайна */
const CLI_TRANSPORT_NAME = transportNameOf(CliTransport$(DEFAULT_INSTANCE));

/**
 * Транспортный словарь CLI-декларации.
 *
 * Легален и типизирован только здесь; пайплайн и хендлер остаются
 * транспорт-слепыми. Стратегия сбора недостающего input (`missing:
 * 'prompt'`) — политика биндинга, которая будет реализована отдельной
 * работой.
 */
export interface CliEndpointDictionary<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
> {
  /** Имя команды; оно же паттерн endpoint'а */
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

  /**
   * Причина вывода команды из-под инвариантов сборки. Транспорт поле не
   * интерпретирует — только пробрасывает в `makeEndpoint` (см.
   * `httpEndpoint`).
   */
  detached?: string;

  /** Имя экземпляра транспорта, обслуживающего команду; по умолчанию `'default'` */
  on?: string;
}

/**
 * Конструктор CLI-деклараций.
 *
 * Тонкая надстройка над kernel-примитивом `makeEndpoint`: `transport` —
 * `'cli'`, `pattern` — имя команды. Общий механизм деклараций (`deps`,
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
  const { command, on, ...rest } = declaration;

  if (typeof command !== 'string' || command.length === 0) {
    throw new Error("cliEndpoint({ … }): 'command' must be a non-empty name.");
  }

  return (makeEndpoint as (options: unknown) => AnyEndpointDefinition)({
    ...rest,
    transport: CliTransport$(on ?? DEFAULT_INSTANCE),
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
   * Диагностический хук проверки границы: получает оригинал отказа,
   * снятого нормализацией в `UnknownError`. Не задан — рантайм пишет в
   * `console.error`.
   */
  onUnknownFail?: (info: UnknownFailInfo) => void;

  /**
   * Что делает `serve` для командной строки:
   *
   * - `'argv'` (по умолчанию) — single-shot: одна команда из аргументов
   *   процесса, затем `serve` возвращается; пустой `argv` не исполняет
   *   ничего;
   * - `'repl'` — команды читаются из stdin до `exit`/`quit`/EOF.
   */
  mode?: 'argv' | 'repl';

  /**
   * Аргументы командной строки для режима `'argv'`.
   * По умолчанию — `process.argv.slice(2)`.
   */
  argv?: readonly string[];
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
 * CLI-транспорт.
 *
 * Запускается единственным способом — `serve(dispatch, signal)`. Что
 * именно происходит при запуске, решает режим: `'argv'` — одна команда
 * из аргументов процесса (single-shot), `'repl'` — чтение команд из
 * stdin до `exit`. Обе ветки исполняют endpoint через `dispatch.call`,
 * своей копии исполнения у транспорта нет.
 */
export class CliTransport implements ITransport {
  /** Способности транспорта: читает `assertFormsSupported` на сборке */
  readonly capabilities: TransportCapabilities = CLI_CAPABILITIES;

  /** Диспетчер, полученный в `serve`; до этого исполнять нечего */
  #dispatch?: Dispatch;

  /** Проекции маршрутов по имени команды — для парсинга входа */
  #routes = new Map<string, RouteDeclaration>();

  #repl?: readline.Interface;

  /**
   * Transport-level канал отмены: сигнал попадает в meta каждой команды
   * и взводится в `close()` — выполняющиеся команды могут завершиться
   * кооперативно. Композируется с сигналом, переданным в `serve`.
   */
  readonly #closeController = new AbortController();

  /** Сигнал команды: `serve`-сигнал ∪ transport-level канал */
  #signal: AbortSignal = this.#closeController.signal;

  constructor(private readonly options: CliTransportOptions = {}) {}

  /**
   * Запускает транспорт.
   *
   * Формы io проверяются здесь же — до чтения хоть одной команды: на
   * standalone-пути это единственная точка проверки, и текст ошибки тот же,
   * что у сборки приложения.
   */
  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    if (this.#dispatch) {
      throw new Error('CLI transport is already serving');
    }

    for (const route of dispatch.routes) {
      assertFormsSupported(route, this.capabilities);
    }

    this.#dispatch = dispatch;
    this.#routes = new Map(
      dispatch.routes.map((route) => [route.pattern, route]),
    );
    this.#signal = AbortSignal.any([signal, this.#closeController.signal]);

    if (this.#mode === 'repl') {
      await this.#runRepl();
      return;
    }

    const argv = this.options.argv ?? process.argv.slice(2);
    if (argv.length > 0) {
      await this.#runOnce(parseArgv(argv));
    }
  }

  /**
   * Выполняет одну команду.
   *
   * Публичная точка single-shot: корень (или тест) строит `CliInput` сам —
   * например, из аргументов процесса, разобранных по своим правилам.
   *
   * @throws {Error} Если транспорт ещё не запущен или команда неизвестна
   */
  async execute(input: CliInput): Promise<ResponseContext> {
    const dispatch = this.#dispatch;
    const route = this.#routes.get(input.command);

    if (!dispatch) {
      throw new Error(
        'CLI transport is not serving: call serve(dispatch, signal) first.',
      );
    }

    if (!route) {
      throw new Error(`Command "${input.command}" not found`);
    }

    // Форма input определяет, как читается вход команды
    const inputForm = describeForm(route.input);
    const outputForm = describeForm(route.output);

    let payload: unknown;
    let streamSource: AsyncIterable<unknown> | undefined;

    if (inputForm.kind === 'stream') {
      // Поток stdin; поэлементную валидацию навесит ядро
      streamSource = this.#streamStdin(inputForm.leaf === 'binary');
    } else {
      // Аргументы и опции — сырой payload команды; валидацию value-формы
      // делает пайплайн (или ядро в ветке без него)
      payload = { args: input.args, ...input.options };
    }

    const raw: Raw = {
      transport: CLI_TRANSPORT_NAME,
      pattern: input.command,
      payload,
      attributes: {
        command: input.command,
        args: input.args,
        options: input.options,
      },
    };

    const endpointMeta: EndpointMeta = {
      transport: CLI_TRANSPORT_NAME,
      pattern: route.pattern,
      input: route.input,
      output: route.output,
      // Объявленные отказы попадают в проверку границы только так:
      // декларация → транспорт → контекст, без глобального реестра.
      errors: route.errors,
    };

    const ctx = makeEmptyContext(raw, endpointMeta, this.#signal);

    if (streamSource) {
      // Обёртка ядра доступна только теперь: счётчики живут в контексте
      raw.payload = bindInputStream(inputForm, streamSource, ctx);
    }

    const response = await dispatch.call(input.command, ctx, {
      // CLI — локальный инструмент: детали ошибок (stack) в терминале полезны
      exposeErrorDetails: true,
      onUnknownFail: this.options.onUnknownFail,
    });

    // Потоковый выход: NDJSON в stdout, завершение по концу потока и по
    // сигналу. Итератор обязан быть либо потреблён, либо закрыт — иначе
    // отложенные `.finally`-юниты не выполнятся.
    if (
      outputForm.kind === 'stream' &&
      response.isSuccess &&
      isAsyncIterable(response.value)
    ) {
      await this.#writeNdjson(response.value);
      return { ...response, value: null };
    }

    return response;
  }

  /**
   * Останавливает транспорт: взводит сигнал выполняющихся команд и
   * закрывает REPL.
   */
  async close(): Promise<void> {
    this.#closeController.abort(new TransportClosingError());

    if (this.#repl) {
      this.#repl.close();
      this.#repl = undefined;
    }

    this.#dispatch = undefined;
    this.#routes = new Map();
  }

  /** Режим запуска: явный из опций, иначе single-shot по argv */
  get #mode(): 'argv' | 'repl' {
    return this.options.mode ?? 'argv';
  }

  /** Single-shot: одна команда, результат в stdout/stderr */
  async #runOnce(input: CliInput): Promise<void> {
    const result = await this.execute(input);

    if (result.isSuccess) {
      if (result.value !== null && result.value !== undefined) {
        console.log(JSON.stringify(result.value, null, 2));
      }
      return;
    }

    process.exitCode = 1;
    console.error(`${result.status}:`, JSON.stringify(result.value));
  }

  /**
   * Стримит stdin как AsyncIterable.
   *
   * Форма `stream('binary')` отдаёт чанки как есть, схема-лист —
   * NDJSON-строки: ядро валидирует их поэлементно.
   */
  async *#streamStdin(binary: boolean): AsyncIterableIterator<unknown> {
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
  async #writeNdjson(source: AsyncIterable<unknown>): Promise<void> {
    for await (const item of untilAborted(source, this.#signal)) {
      const line =
        typeof item === 'string' ? item : `${JSON.stringify(item)}\n`;
      process.stdout.write(line);
    }
  }

  /** REPL: команды из stdin до `exit`/`quit`/EOF */
  async #runRepl(): Promise<void> {
    this.#repl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });

    this.#repl.prompt();

    return new Promise((resolve) => {
      const repl = this.#repl as readline.Interface;

      repl.on('line', async (line: string) => {
        const trimmed = line.trim();

        if (trimmed === 'exit' || trimmed === 'quit') {
          this.#repl?.close();
          resolve();
          return;
        }

        if (trimmed === '') {
          this.#repl?.prompt();
          return;
        }

        try {
          await this.#runOnce(parseArgv(trimmed.split(/\s+/)));
        } catch (error) {
          console.error(
            'Error:',
            error instanceof Error ? error.message : error,
          );
          process.exitCode = 1;
        }

        this.#repl?.prompt();
      });

      repl.on('close', () => {
        resolve();
      });
    });
  }
}

/**
 * Разбирает аргументы командной строки в `CliInput`.
 *
 * `--key value` становится опцией, `--flag` без значения — `true`,
 * остальное — позиционными аргументами.
 */
export function parseArgv(argv: readonly string[]): CliInput {
  const command = argv[0] ?? '';
  const args: string[] = [];
  const options: Record<string, unknown> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith('--')) {
      args.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];

    if (next && !next.startsWith('--')) {
      options[key] = next;
      i++; // значение опции, а не отдельный аргумент
    } else {
      options[key] = true; // флаг без значения
    }
  }

  return { command, args, options };
}

/**
 * Объявляет экземпляр CLI-транспорта.
 *
 * Транспорт — обычный узел графа; объявление называет его экземпляр,
 * а декларация выбирает свой через `on:`.
 *
 * @example
 * ```typescript
 * await assemble({ features: [Tools], transports: [cli()] }).run();
 * ```
 */
export const cli = <const Name extends string = typeof DEFAULT_INSTANCE>(
  options: CliTransportOptions & { readonly name?: Name } = {},
): TransportDeclaration<Name> => {
  const { name = DEFAULT_INSTANCE as Name, ...transportOptions } = options;
  const token = CliTransport$(name);

  return makeTransportDeclaration({
    name,
    token,
    provider: factoryProvider(
      token,
      () => new CliTransport(transportOptions),
      [],
    ),
  });
};
