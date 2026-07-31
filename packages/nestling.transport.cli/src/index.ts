/* eslint-disable no-console */
import * as readline from 'node:readline';

import type {
  FactoryProviderWithDeps,
  InjectionToken,
} from '@nestling/container';
import { factoryProvider, makeToken } from '@nestling/container';
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
  TransportToken,
} from '@nestling/transport';
import { transportNameOf } from '@nestling/transport';

/**
 * Токен CLI-транспорта.
 *
 * Им ссылается на транспорт каждая `cliEndpoint`-декларация; `App` берёт по
 * нему инстанс из графа.
 */
export const CliTransport$: TransportToken = makeToken('transport:cli');

/** Короткое имя транспорта (`'cli'`) — то же, что читают слои пайплайна */
const CLI_TRANSPORT_NAME = transportNameOf(CliTransport$);

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

  /**
   * Причина вывода команды из-под инвариантов сборки. Транспорт поле не
   * интерпретирует — только пробрасывает в `makeEndpoint` (см.
   * `httpEndpoint`).
   */
  detached?: string;
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
    transport: CliTransport$,
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

  /**
   * Что значит «выйти в эфир» для командной строки:
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
 * В эфир выходит единственным способом — `serve(dispatch, signal)`. Что
 * именно значит «эфир» для командной строки, решает режим: `'argv'` —
 * одна команда из аргументов процесса (single-shot), `'repl'` — чтение
 * команд из stdin до `exit`. Обе ветки исполняют ручку через
 * `dispatch.call`, своей копии исполнения у транспорта нет.
 */
export class CliTransport implements ITransport {
  /** Способности транспорта: читает `assertFormsSupported` на сборке */
  readonly capabilities: TransportCapabilities = CLI_CAPABILITIES;

  /** Диспетчер, полученный в `serve`; до go-live исполнять нечего */
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
   * Выводит транспорт в эфир.
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
   * @throws {Error} Если транспорт ещё не в эфире или команда неизвестна
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
      // Объявленные отказы доезжают до стража только так: декларация →
      // транспорт → контекст, без глобального реестра.
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

  /** Режим go-live: явный из опций, иначе single-shot по argv */
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
 * Фабрика провайдера CLI-транспорта.
 *
 * Транспорт — обычный узел графа: `assemble({ transports: [cli()] })` — это
 * сахар регистрации провайдера, и ровно тот же провайдер легально объявить
 * в `providers:` infra-модуля фичи.
 *
 * @example
 * ```typescript
 * await assemble({ modules: [ToolsModule], transports: [cli()] }).run();
 * ```
 */
export const cli = (
  options: CliTransportOptions = {},
): FactoryProviderWithDeps<ITransport, []> =>
  factoryProvider(CliTransport$, () => new CliTransport(options), []);
