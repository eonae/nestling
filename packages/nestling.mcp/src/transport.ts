/**
 * `McpTransport` — транспорт MCP и его объявление `mcp(...)`.
 *
 * Сокет транспорту не принадлежит: его держит `HttpServer`, а транспорт
 * присоединяет к нему обработчик в `serve`. Поэтому на одном порту
 * работают и endpoint'ы `http()`, и сообщения протокола.
 *
 * Определения инструментов строятся в `serve`, до того как сервер откроет
 * сокет: `listen` — последний шаг START, и нарушение объявления валит
 * старт раньше, чем агент сможет прислать первый запрос.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BoundTool } from './definitions.js';
import { buildToolDefinitions } from './definitions.js';
import type { McpContext, McpOutcome, McpRequest } from './handler.js';
import { closeSession, handleMessage, SESSION_HEADER } from './handler.js';
import type { McpRuntimeOptions } from './options.js';
import {
  DEFAULT_PATH,
  DEFAULT_SESSION_IDLE_MS,
  DEFAULT_SESSION_LIMIT,
} from './options.js';
import { McpSessions } from './sessions.js';
import { McpTransport$ } from './token.js';
import type { McpServerInfo } from './types.js';

import type {
  Dispatch,
  ITransport,
  ResponseContext,
  SchemaDocConverter,
  ServerDeclaration,
  TransportCapabilities,
  TransportDeclaration,
} from '@nestlingjs/app';
import {
  assertConverters,
  assertFormsSupported,
  ClientDisconnectedError,
  DEFAULT_INSTANCE,
  makeTransportDeclaration,
  PayloadTooLarge,
  TransportClosingError,
} from '@nestlingjs/app';
import { factoryProvider } from '@nestlingjs/container';
import type { HttpServer } from '@nestlingjs/transport.http';
import {
  HttpServer$,
  parseRaw,
  PayloadTooLargeError,
  sendResponse,
  server as declareServer,
} from '@nestlingjs/transport.http';

/**
 * Предельный размер сообщения протокола — 1 MiB.
 *
 * Константа, а не опция: вызов инструмента это небольшой объект JSON, и
 * приложению, которому мало мегабайта на аргументы, нужен не инструмент
 * агента, а загрузка файла.
 */
const MAX_MESSAGE_BYTES = 1024 * 1024;

/**
 * Формы io, которые умеет транспорт MCP.
 *
 * Только `value` в обе стороны: аргументы и результат вызова инструмента —
 * значения. Потока, `events` и `multipart` у вызова инструмента нет, и
 * декларация с такой формой отвергается проверкой форм ядра.
 */
export const MCP_CAPABILITIES: TransportCapabilities = {
  input: new Set(['value']),
  output: new Set(['value']),
};

/**
 * Транспорт MCP.
 *
 * Переводит сообщения протокола в вызовы `dispatch.call` и обратно.
 * Собственного исполнения у него нет: инструмент проходит пайплайн своей
 * декларации — тот же путь, что обычный HTTP-запрос.
 */
export class McpTransport implements ITransport {
  /** Диспетчер из `serve`; до вызова `serve` исполнять нечего */
  #dispatch?: Dispatch;

  /** Инструменты с готовыми определениями; строятся один раз в `serve` */
  #tools: readonly BoundTool[] = [];

  /** Карта сессий: состояние экземпляра, очищается в `close()` */
  readonly #sessions: McpSessions;

  /** Контроллер остановки транспорта: взводится первым шагом `close()` */
  #closeController?: AbortController;

  /**
   * Контроллеры выполняющихся запросов: `close()` взводит каждый
   * оставшийся, и хендлеры завершаются кооперативно.
   */
  readonly #active = new Set<AbortController>();

  /**
   * @param server - Сервер, к которому транспорт присоединяет обработчик
   * @param options - Опции транспорта после нормализации
   * @param converters - Конвертеры схем в JSON Schema
   */
  constructor(
    private readonly server: HttpServer,
    private readonly options: McpRuntimeOptions,
    private readonly converters?: readonly SchemaDocConverter[],
  ) {
    this.#sessions = new McpSessions(options);
  }

  /** Инструменты, которые транспорт отдаёт агенту; пусты до `serve` */
  get tools(): readonly BoundTool[] {
    return this.#tools;
  }

  /**
   * Строит определения инструментов и присоединяет обработчик к серверу.
   *
   * Сокет при этом не открывается: его открывает сервер следующим шагом
   * START, когда обработчики присоединили все транспорты. Нарушение
   * объявления бросается здесь же — до того, как агент сможет прислать
   * запрос.
   *
   * @param dispatch - Маршруты этого транспорта и функция исполнения
   * @param signal - Сигнал остановки; `App` подаёт его первым шагом SHUTDOWN
   * @throws {Error} Перечисление нарушений объявления одним сообщением
   */
  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    if (this.#dispatch) {
      throw new Error('MCP transport is already serving');
    }

    for (const route of dispatch.routes) {
      assertFormsSupported(route, MCP_CAPABILITIES);
    }

    this.#tools = buildToolDefinitions(dispatch.routes, {
      converters: this.converters,
    });

    this.#dispatch = dispatch;
    this.#closeController = new AbortController();

    // Внешний сигнал останавливает транспорт так же, как `close()`
    signal.addEventListener('abort', () => void this.close(), { once: true });

    this.server.attach((req, res) => this.#handle(req, res));
  }

  /**
   * Отменяет запросы в обработке и закрывает сессии.
   *
   * Сокета не касается: соединения дренажит сервер, и делает это раньше —
   * первым шагом SHUTDOWN.
   */
  async close(): Promise<void> {
    if (!this.#dispatch) {
      return;
    }

    this.#dispatch = undefined;
    this.#tools = [];

    const reason = new TransportClosingError();
    this.#closeController?.abort(reason);
    this.#closeController = undefined;
    for (const controller of this.#active) {
      controller.abort(reason);
    }
    this.#active.clear();
    this.#sessions.clear();
  }

  /** Число открытых сессий; нужно тестам и диагностике */
  get openSessions(): number {
    return this.#sessions.size;
  }

  /**
   * Обрабатывает один запрос.
   *
   * `POST` по пути транспорта несёт сообщение протокола, `DELETE` по нему
   * же закрывает сессию. Прочее транспорт не берёт и возвращает `false`:
   * запрос уходит следующему обработчику цепочки, а ответ о ненайденном
   * маршруте — дело сервера.
   *
   * `GET` не берётся намеренно: поток событий нужен серверу, который сам
   * инициирует сообщения, а таких сообщений у пакета нет.
   */
  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    const dispatch = this.#dispatch;
    if (!dispatch) {
      return false;
    }

    const url = request.url ?? '/';
    const separator = url.indexOf('?');
    const path = separator === -1 ? url : url.slice(0, separator);

    if (path !== this.options.path) {
      return false;
    }

    const method = request.method ?? 'GET';
    if (method !== 'POST' && method !== 'DELETE') {
      return false;
    }

    const controller = new AbortController();
    this.#active.add(controller);

    // 'close' приходит и после штатного завершения ответа, поэтому
    // дисконнектом считаем только недописанный ответ
    response.on('close', () => {
      this.#active.delete(controller);
      if (!response.writableFinished) {
        controller.abort(new ClientDisconnectedError());
      }
    });

    const context: McpContext = {
      tools: this.#tools,
      sessions: this.#sessions,
      options: this.options,
      dispatch,
    };

    try {
      const outcome =
        method === 'DELETE'
          ? closeSession(
              { body: '', headers: request.headers, signal: controller.signal },
              context,
            )
          : await handleMessage(
              await this.#read(request, controller.signal),
              context,
            );

      await this.#respond(response, outcome);
    } catch (error) {
      await this.#respond(response, { kind: 'fail', fail: failOf(error) });
    }

    return true;
  }

  /** Читает тело запроса текстом; разбирает его обработчик протокола */
  async #read(
    request: IncomingMessage,
    signal: AbortSignal,
  ): Promise<McpRequest> {
    const raw = await parseRaw(request, MAX_MESSAGE_BYTES);

    return { body: raw.toString(), headers: request.headers, signal };
  }

  /** Кадрирует исход обработчика в ответ HTTP */
  async #respond(response: ServerResponse, outcome: McpOutcome): Promise<void> {
    if (response.headersSent) {
      return;
    }

    if (outcome.kind === 'response' && outcome.sessionId !== undefined) {
      response.setHeader(SESSION_HEADER, outcome.sessionId);
    }

    await sendResponse(response, contextOf(outcome), { kind: 'value' });
  }
}

/** Переводит исход обработчика в контекст ответа */
function contextOf(outcome: McpOutcome): ResponseContext {
  switch (outcome.kind) {
    case 'accepted': {
      // Нотификация принята: 202 без тела, как требует спецификация
      return { isSuccess: true, status: 'accepted', value: null };
    }
    case 'closed': {
      return { isSuccess: true, status: 'no_content', value: null };
    }
    case 'fail': {
      const { fail } = outcome;

      return {
        isSuccess: false,
        status: fail.category,
        value: {
          error: fail.message,
          code: fail.code,
          ...(fail.details === undefined ? {} : { details: fail.details }),
        },
      };
    }
    default: {
      return { isSuccess: true, status: 'ok', value: outcome.body };
    }
  }
}

/**
 * Переводит ошибку чтения запроса в отказ.
 *
 * Сообщения протокола на этой стадии ещё нет, поэтому ответ — отказ
 * транспорта, а не ответ JSON-RPC.
 */
function failOf(error: unknown) {
  if (error instanceof PayloadTooLargeError) {
    return PayloadTooLarge({ limit: error.limit });
  }

  throw error;
}

/** Словарь объявления транспорта */
export interface McpTransportOptions {
  /**
   * Имя и версия сервера; уходят агенту в ответе `initialize`.
   *
   * Обязательны: агент показывает их пользователю, когда спрашивает
   * разрешение на вызов инструмента.
   */
  readonly info: McpServerInfo;

  /**
   * Сервер, на котором работает транспорт.
   *
   * Без него фабрика объявляет собственный сервер с именем транспорта —
   * так же, как это делает `http()`.
   */
  readonly server?: ServerDeclaration;

  /**
   * Конвертеры листовых схем: список — данные вызывающего.
   *
   * Те же, что у генератора OpenAPI. Отсутствие конвертера для вендора
   * встреченной схемы — нарушение старта, а не молчаливый пропуск.
   */
  readonly converters?: readonly SchemaDocConverter[];

  /** Путь, по которому транспорт берёт `POST` и `DELETE`; по умолчанию `/mcp` */
  readonly path?: string;

  /** Предельное число открытых сессий; по умолчанию 100 */
  readonly sessionLimit?: number;

  /** Срок бездействия сессии в миллисекундах; по умолчанию пять минут */
  readonly sessionIdleMs?: number;
}

/** Поля словаря; этот же список печатает текст ошибки */
const OPTION_FIELDS = [
  'info',
  'server',
  'converters',
  'path',
  'name',
  'sessionLimit',
  'sessionIdleMs',
] as const;

/** Проверяет словарь объявления до создания значения */
function assertOptions(options: McpTransportOptions): void {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError(
      `mcp(options): the argument must be an object with ` +
        `${OPTION_FIELDS.join(', ')}.`,
    );
  }

  for (const field of Object.keys(options)) {
    if (!(OPTION_FIELDS as readonly string[]).includes(field)) {
      throw new TypeError(
        `mcp({ ${field} }): unknown field '${field}'. The dictionary ` +
          `accepts ${OPTION_FIELDS.join(', ')}.`,
      );
    }
  }

  const { name, version } = options.info ?? {};

  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError(
      `mcp({ info }): 'info.name' is required and must be a non-empty ` +
        `string. The agent shows it to the user.`,
    );
  }

  if (typeof version !== 'string' || version.length === 0) {
    throw new TypeError(
      `mcp({ info }): 'info.version' is required and must be a non-empty ` +
        `string.`,
    );
  }

  assertConverters(options.converters);
}

/** Нормализует опции: подставляет умолчания */
function runtimeOptions(options: McpTransportOptions): McpRuntimeOptions {
  return {
    info: { ...options.info },
    path: options.path ?? DEFAULT_PATH,
    sessionLimit: options.sessionLimit ?? DEFAULT_SESSION_LIMIT,
    sessionIdleMs: options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS,
  };
}

/**
 * Объявляет экземпляр транспорта MCP.
 *
 * Возвращает объявление, а не экземпляр: транспорт — обычный узел графа.
 * Экземпляров может быть несколько; каждый получает своё имя, а декларация
 * инструмента выбирает свой через `on:`.
 *
 * @param options - Сведения о сервере, сервер, конвертеры схем, путь и
 * опции сессий
 * @returns Объявление транспорта для `transports:` корня
 * @throws {TypeError} Неизвестное поле словаря либо дефектное значение поля
 *
 * @example Один сокет на два протокола
 * ```typescript
 * const api = server();
 *
 * makeApp({
 *   features: [UsersFeature],
 *   transports: [
 *     http({ server: api }),
 *     mcp({
 *       server: api,
 *       info: { name: 'users-service', version: '1.0.0' },
 *       converters: [zodConverter()],
 *     }),
 *   ],
 * });
 * // POST /mcp
 * ```
 */
export const mcp = <const Name extends string = typeof DEFAULT_INSTANCE>(
  options: McpTransportOptions & { readonly name?: Name },
): TransportDeclaration<Name> => {
  assertOptions(options);

  const {
    name = DEFAULT_INSTANCE as Name,
    server = declareServer({ name }),
    converters,
  } = options;
  const token = McpTransport$(name);
  const runtime = runtimeOptions(options);

  return makeTransportDeclaration({
    name,
    token,
    capabilities: MCP_CAPABILITIES,
    server,
    provider: factoryProvider(
      token,
      (instance: HttpServer) => new McpTransport(instance, runtime, converters),
      [HttpServer$(server.name)],
    ),
  });
};
