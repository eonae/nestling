/**
 * CLI-транспорт: разбор argv, исполнение команды, REPL и вопросы.
 */

import * as readline from 'node:readline';

import { cliBindingOf } from './cli-endpoint.js';
import type { PromptPlan } from './prompt.js';
import { buildPromptPlan, formatQuestion, readAnswer } from './prompt.js';
import { CLI_TRANSPORT_NAME, CliTransport$ } from './token.js';

import type {
  Dispatch,
  EndpointMeta,
  ITransport,
  Raw,
  ResponseContext,
  RouteDeclaration,
  SchemaDocConverter,
  TransportCapabilities,
  TransportDeclaration,
} from '@nestlingjs/app';
import {
  assertConverters,
  assertFormsSupported,
  bindInputStream,
  DEFAULT_INSTANCE,
  describeForm,
  isAsyncIterable,
  makeEmptyContext,
  makeTransportDeclaration,
  TransportClosingError,
} from '@nestlingjs/app';
import { factoryProvider } from '@nestlingjs/container';
import { untilAborted } from '@nestlingjs/operations';
import { withZodDefault } from '@nestlingjs/schema.zod';

/**
 * Входные данные для CLI транспорта
 */
export interface CliInput {
  command: string;
  args: string[];
  options: Record<string, unknown>;
}

/**
 * Поток ввода транспорта: `process.stdin` или подставленный поток.
 *
 * `isTTY` необязателен: подставленный поток терминалом не является, и
 * вопросы для него включает опция `interactive`.
 */
export type CliInputStream = NodeJS.ReadableStream & {
  readonly isTTY?: boolean;
};

/**
 * Опции CLI транспорта
 */
export interface CliTransportOptions {
  /**
   * Что делает `serve` для командной строки:
   *
   * - `'argv'` (по умолчанию) — single-shot: одна команда из аргументов
   *   процесса, затем `serve` возвращается; пустой `argv` не исполняет
   *   ничего;
   * - `'repl'` — команды читаются из потока ввода до `exit`/`quit`/EOF.
   */
  mode?: 'argv' | 'repl';

  /**
   * Аргументы командной строки для режима `'argv'`.
   * По умолчанию — `process.argv.slice(2)`.
   */
  argv?: readonly string[];

  /**
   * Поток ввода: команды REPL, вопросы и потоковый вход команды.
   * По умолчанию — `process.stdin`.
   */
  input?: CliInputStream;

  /**
   * Поток вывода: результат команды, NDJSON и текст вопросов.
   * По умолчанию — `process.stdout`.
   */
  output?: NodeJS.WritableStream;

  /**
   * Поток ошибок: отказ команды и ошибка разбора в REPL.
   * По умолчанию — `process.stderr`.
   */
  errorOutput?: NodeJS.WritableStream;

  /**
   * Конвертеры схем для команд с политикой `missing: 'prompt'`.
   *
   * Конвертер нужен только таким командам: вопрос выводится из JSON Schema
   * формы `input`, а Standard Schema интроспекции не даёт.
   *
   * Поле необязательно: конвертер вендора, на котором написаны схемы
   * фреймворка, подставляется умолчанием. Список **добавляет** конвертер
   * другого вендора или **заменяет** умолчание своим.
   */
  converters?: readonly SchemaDocConverter[];

  /**
   * Задавать ли вопросы. Без опции решает среда: поток ввода — терминал и
   * переменная `CI` не задана.
   *
   * Опция нужна тестам: подставленный поток ввода терминалом не является,
   * и без явного `true` вопросы не задавались бы никогда.
   */
  interactive?: boolean;
}

/**
 * Формы io, которые умеет CLI.
 *
 * `events` нет: у команды нет открытого соединения, дисконнект которого
 * был бы нормальным завершением. `multipart` нет: файлы приходят путями в
 * аргументах, а не полями формы.
 */
export const CLI_CAPABILITIES: TransportCapabilities = {
  input: new Set(['value', 'stream']),
  output: new Set(['value', 'stream']),
};

/**
 * CLI-транспорт.
 *
 * Запускается единственным способом — `serve(dispatch, signal)`. Что
 * именно происходит при запуске, решает режим: `'argv'` — одна команда
 * из аргументов процесса (single-shot), `'repl'` — чтение команд из
 * потока ввода до `exit`. Обе ветки исполняют endpoint через
 * `dispatch.call`, своей копии исполнения у транспорта нет.
 */
export class CliTransport implements ITransport {
  /** Диспетчер, полученный в `serve`; до этого исполнять нечего */
  #dispatch?: Dispatch;

  /** Проекции маршрутов по имени команды — для парсинга входа */
  #routes = new Map<string, RouteDeclaration>();

  /** Планы вопросов по имени команды: строятся на `serve`, один раз */
  #plans = new Map<string, PromptPlan>();

  #repl?: readline.Interface;

  /**
   * Transport-level канал отмены: сигнал попадает в meta каждой команды
   * и взводится в `close()` — выполняющиеся команды могут завершиться
   * кооперативно. Композируется с сигналом, переданным в `serve`.
   */
  readonly #closeController = new AbortController();

  /** Сигнал команды: `serve`-сигнал ∪ transport-level канал */
  #signal: AbortSignal = this.#closeController.signal;

  /**
   * Разрешённый список конвертеров: умолчание плюс список вызывающего.
   *
   * Считается один раз на транспорт — там же, где список проверяется на
   * дубли вендора.
   */
  readonly #converters: readonly SchemaDocConverter[];

  constructor(private readonly options: CliTransportOptions = {}) {
    assertConverters(options.converters);
    this.#converters = withZodDefault(options.converters);
  }

  /**
   * Запускает транспорт.
   *
   * Формы io и планы вопросов проверяются здесь же — до чтения хоть одной
   * команды: на standalone-пути это единственная точка проверки, и текст
   * ошибки тот же, что у сборки приложения.
   *
   * @throws {Error} Если у команды с политикой `'prompt'` поток на входе
   * или нет конвертера для вендора её схемы
   */
  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    if (this.#dispatch) {
      throw new Error('CLI transport is already serving');
    }

    for (const route of dispatch.routes) {
      assertFormsSupported(route, CLI_CAPABILITIES);
    }

    this.#plans = new Map(
      dispatch.routes
        .filter((route) => cliBindingOf(route).missing === 'prompt')
        .map((route) => [
          route.pattern,
          buildPromptPlan(route, this.#converters),
        ]),
    );

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
      // Поток ввода; поэлементную валидацию навесит ядро
      streamSource = this.#streamInput(inputForm.leaf === 'binary');
    } else {
      // Аргументы и опции — сырой payload команды; валидацию value-формы
      // делает пайплайн (или ядро в ветке без него)
      const values: Record<string, unknown> = {
        args: input.args,
        ...input.options,
      };

      // Недостающее достраивается до валидации и тем же путём уходит в
      // `dispatch.call`: второго входа в исполнение у вопросов нет
      await this.#promptMissing(input.command, values);
      payload = values;
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
    });

    // Потоковый выход: NDJSON в поток вывода, завершение по концу потока и
    // по сигналу. Итератор обязан быть либо потреблён, либо закрыт — иначе
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
    this.#plans = new Map();
  }

  /** Режим запуска: явный из опций, иначе single-shot по argv */
  get #mode(): 'argv' | 'repl' {
    return this.options.mode ?? 'argv';
  }

  /** Поток ввода: подставленный или `process.stdin` */
  get #input(): CliInputStream {
    return this.options.input ?? process.stdin;
  }

  /** Поток вывода: подставленный или `process.stdout` */
  get #output(): NodeJS.WritableStream {
    return this.options.output ?? process.stdout;
  }

  /** Поток ошибок: подставленный или `process.stderr` */
  get #errorOutput(): NodeJS.WritableStream {
    return this.options.errorOutput ?? process.stderr;
  }

  /**
   * Задавать ли вопросы.
   *
   * Опция решает явно и среду не смотрит. Без неё вопросы задаются только
   * в терминале и только вне CI: процесс в конвейере не должен зависнуть
   * на вопросе, которого никто не увидит.
   */
  get #interactive(): boolean {
    if (this.options.interactive !== undefined) {
      return this.options.interactive;
    }

    const ci = process.env.CI;

    return this.#input.isTTY === true && (ci === undefined || ci === '');
  }

  /** Single-shot: одна команда, результат в потоки вывода */
  async #runOnce(input: CliInput): Promise<void> {
    const result = await this.execute(input);

    if (result.isSuccess) {
      if (result.value !== null && result.value !== undefined) {
        this.#output.write(`${JSON.stringify(result.value, null, 2)}\n`);
      }
      return;
    }

    process.exitCode = 1;
    this.#errorOutput.write(
      `${result.status}: ${JSON.stringify(result.value)}\n`,
    );
  }

  /**
   * Достраивает недостающие обязательные поля вопросами.
   *
   * Спрашиваются только поля плана, которых нет в собранном из argv
   * payload: заданное флагом поле вопроса не даёт. Вне терминала вопросов
   * нет вовсе — команда доходит до валидации и отвечает отказом.
   */
  async #promptMissing(
    command: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const plan = this.#plans.get(command);
    if (!plan || plan.length === 0 || !this.#interactive) {
      return;
    }

    const questions = plan.filter(
      (question) => !Object.hasOwn(payload, question.field),
    );

    if (questions.length === 0) {
      return;
    }

    // В REPL интерфейс уже открыт: второй читатель поделил бы строки
    // ввода с первым. В `'argv'` он открывается только теперь — команде
    // без недостающих полей терминал не нужен
    const opened = this.#repl;
    const rl =
      opened ??
      readline.createInterface({
        input: this.#input,
        output: this.#output,
      });

    try {
      for (const question of questions) {
        const answer = await ask(rl, formatQuestion(question));

        // Конец ввода: поле остаётся незаданным, дальше работает
        // валидация — отдельного отказа «диалог прерван» нет
        if (answer === END_OF_INPUT) {
          return;
        }

        const value = readAnswer(question, answer);
        if (value !== undefined) {
          payload[question.field] = value;
        }
      }
    } finally {
      if (!opened) {
        rl.close();
      }
    }
  }

  /**
   * Стримит поток ввода как AsyncIterable.
   *
   * Форма `stream('binary')` отдаёт чанки как есть, схема-лист —
   * NDJSON-строки: ядро валидирует их поэлементно.
   */
  async *#streamInput(binary: boolean): AsyncIterableIterator<unknown> {
    const input = this.#input;

    if (input.isTTY === true) {
      return; // Нет данных во вводе
    }

    if (binary) {
      yield* input;
      return;
    }

    let buffer = '';
    for await (const chunk of input) {
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

  /** NDJSON в поток вывода: по одному JSON-объекту на строку */
  async #writeNdjson(source: AsyncIterable<unknown>): Promise<void> {
    for await (const item of untilAborted(source, this.#signal)) {
      const line =
        typeof item === 'string' ? item : `${JSON.stringify(item)}\n`;
      this.#output.write(line);
    }
  }

  /** REPL: команды из потока ввода до `exit`/`quit`/EOF */
  async #runRepl(): Promise<void> {
    this.#repl = readline.createInterface({
      input: this.#input,
      output: this.#output,
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

        // Команда выполняется — ввод не читается: иначе следующая строка
        // разобралась бы командой, хотя её ждёт вопрос этой. Чтение
        // возобновляет `prompt()` — свой у вопроса, общий у REPL
        repl.pause();

        try {
          await this.#runOnce(parseArgv(trimmed.split(/\s+/)));
        } catch (error) {
          this.#errorOutput.write(
            `Error: ${error instanceof Error ? error.message : String(error)}\n`,
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

/** Конец ввода вместо ответа: значение, которого не даст ни одна строка */
const END_OF_INPUT = Symbol('cli:end-of-input');

/**
 * Задаёт один вопрос интерфейсом readline.
 *
 * Конец ввода различается отдельным значением: `question` в этом случае
 * обратного вызова не получает, и о закончившемся вводе сообщает только
 * событие `close`.
 *
 * Ответ останавливает чтение: строки, пришедшие одним куском, readline
 * разбирает подряд, и следующая ушла бы в пустоту — вопроса, который её
 * ждёт, ещё нет. Чтение возобновляет сам `question` следующего вопроса.
 */
function ask(
  rl: readline.Interface,
  query: string,
): Promise<string | typeof END_OF_INPUT> {
  return new Promise((resolve) => {
    const onClose = (): void => resolve(END_OF_INPUT);

    rl.once('close', onClose);
    rl.question(query, (answer: string) => {
      rl.pause();
      rl.off('close', onClose);
      resolve(answer);
    });
  });
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
    capabilities: CLI_CAPABILITIES,
    name,
    token,
    provider: factoryProvider(
      token,
      () => new CliTransport(transportOptions),
      [],
    ),
  });
};
