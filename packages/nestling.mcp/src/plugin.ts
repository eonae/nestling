/**
 * `mcp(...)` — параметризованный плагин-сервер MCP.
 *
 * Плагин ставит endpoint'ы на уже объявленный HTTP-транспорт: своего
 * сервера и своего порта у него нет. Определения инструментов строит
 * провайдер, а провайдера зовёт жадный контейнер на фазе ASSEMBLE —
 * поэтому нарушения объявления валят сборку до INIT и до `serve`.
 *
 * Вызыватель операции появляется в графе только тогда, когда его объявили
 * зависимостью. Поэтому список зависимостей провайдера — это и есть список
 * `tools:`, а операция вне списка узла не создаёт.
 */

import type { BoundToolDefinition } from './definitions.js';
import { buildToolDefinitions } from './definitions.js';
import { MCP_ENDPOINT_FAILS, McpSessionNotFound } from './errors.js';
import type { BoundTool, McpOutcome } from './handler.js';
import { handleMessage, SESSION_HEADER } from './handler.js';
import type { McpRuntimeOptions } from './options.js';
import {
  DEFAULT_PATH,
  DEFAULT_SESSION_IDLE_MS,
  DEFAULT_SESSION_LIMIT,
  McpOptions$,
} from './options.js';
import type { AnyRequestOperation, DeclaredTool } from './tool.js';
import type { McpServerInfo } from './types.js';

import { McpSessions } from './sessions.js';

import type {
  AnyInput,
  Pipeline,
  Plugin,
  Port,
  SchemaDocConverter,
} from '@nestlingjs/app';
import { assertConverters, makePlugin, Ok } from '@nestlingjs/app';
import type { InjectionToken } from '@nestlingjs/container';
import { factoryProvider, Handler, makeToken, valueProvider } from '@nestlingjs/container';
import type { HttpRequest } from '@nestlingjs/transport.http';
import { httpEndpoint, HttpResponse } from '@nestlingjs/transport.http';

/**
 * Что хендлеры плагина читают из `meta`.
 *
 * Тип уже `HttpHandlerMeta`: слот `pipeline` приносит в `meta` поля
 * приложения, и требовать от него полный интерфейс значило бы отвергать
 * законный слой.
 */
interface RequestMeta {
  readonly signal: AbortSignal;
  readonly http: HttpRequest;
}

/**
 * DI-токен готовых инструментов.
 *
 * Публичен намеренно: определения бывают нужны не только своему
 * endpoint'у — их инжектируют, чтобы сверить снимком в тесте или отдать в
 * другом виде.
 */
export const McpTools$: InjectionToken<readonly BoundTool[]> = makeToken<
  readonly BoundTool[]
>('nestling:mcp:tools');

/** Словарь объявления плагина */
export interface McpOptions<P extends AnyInput = AnyInput, PN = never> {
  /** Имя и версия сервера; уходят клиенту в ответе `initialize` */
  readonly server: McpServerInfo;

  /**
   * Инструменты, которые сервер выставляет агенту.
   *
   * Список — единственный источник состава. Операция, которой здесь нет,
   * агенту недоступна, и вызывателя для неё в графе не появляется.
   */
  readonly tools: readonly DeclaredTool<AnyRequestOperation>[];

  /**
   * Конвертеры листовых схем: список — данные вызывающего.
   *
   * Те же, что у генератора OpenAPI. Отсутствие конвертера для вендора
   * встреченной схемы — нарушение сборки, а не молчаливый пропуск.
   */
  readonly converters?: readonly SchemaDocConverter[];

  /** Путь endpoint'а; по умолчанию `/mcp` */
  readonly path?: string;

  /**
   * Пайплайн endpoint'ов плагина.
   *
   * Обязателен как возможность: приложение может требовать политикой слой
   * на каждом HTTP-endpoint'е, а сателлит про этот слой ничего не знает.
   */
  readonly pipeline?: Pipeline<AnyInput, P, PN>;

  /** Причина вывода endpoint'ов плагина из-под инвариантов сборки */
  readonly detached?: string;

  /** Предельное число открытых сессий; по умолчанию 100 */
  readonly sessionLimit?: number;

  /** Срок бездействия сессии в миллисекундах; по умолчанию пять минут */
  readonly sessionIdleMs?: number;
}

/** Поля словаря; этот же список печатает текст ошибки */
const OPTION_FIELDS = [
  'server',
  'tools',
  'converters',
  'path',
  'pipeline',
  'detached',
  'sessionLimit',
  'sessionIdleMs',
] as const;

/** Проверяет словарь объявления до создания единого значения */
function assertOptions(options: McpOptions<any, any>): void {
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

  const { name, version } = options.server ?? {};

  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError(
      `mcp({ server }): 'server.name' is required and must be a non-empty ` +
        `string. The agent shows it to the user.`,
    );
  }

  if (typeof version !== 'string' || version.length === 0) {
    throw new TypeError(
      `mcp({ server }): 'server.version' is required and must be a ` +
        `non-empty string.`,
    );
  }

  if (!Array.isArray(options.tools)) {
    throw new TypeError(
      `mcp({ tools }): 'tools' is required and must be an array of ` +
        `tool(Operation, { … }) values.`,
    );
  }

  for (const [index, declared] of options.tools.entries()) {
    if (
      typeof declared !== 'object' ||
      declared === null ||
      typeof (declared as DeclaredTool).name !== 'string'
    ) {
      throw new TypeError(
        `mcp({ tools }): tools[${index}] is not a tool declaration. Declare ` +
          `each one with tool(Operation, { … }).`,
      );
    }
  }

  assertConverters(options.converters);
}

/** Нормализует опции: подставляет значения по умолчанию */
function runtimeOptions(options: McpOptions<any, any>): McpRuntimeOptions {
  return {
    server: { ...options.server },
    sessionLimit: options.sessionLimit ?? DEFAULT_SESSION_LIMIT,
    sessionIdleMs: options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS,
  };
}

/** Сшивает определения с портами их операций в порядке объявления */
function bindPorts(
  definitions: readonly BoundToolDefinition[],
  ports: readonly Port<any>[],
): BoundTool[] {
  return definitions.map((definition, index) => ({
    ...definition,
    port: ports[index],
  }));
}

/** Переводит исход обработчика в ответ HTTP */
function respond(outcome: McpOutcome) {
  switch (outcome.kind) {
    case 'accepted': {
      // Нотификация принята: статус 202 и пустое тело, как требует
      // спецификация протокола
      return new Ok('accepted', null);
    }
    case 'fail': {
      return outcome.fail;
    }
    default: {
      return outcome.sessionId === undefined
        ? new Ok(outcome.body)
        : HttpResponse.of(new Ok(outcome.body), {
            headers: { [SESSION_HEADER]: outcome.sessionId },
          });
    }
  }
}

/**
 * Сервер MCP на объявленном HTTP-транспорте.
 *
 * @param options - Сведения о сервере, список инструментов, конвертеры
 * схем и подача endpoint'ов
 * @returns Значение-плагин для `plugins:` корня
 * @throws {TypeError} Неизвестное поле словаря либо дефектное значение поля
 *
 * @example
 * ```typescript
 * makeApp({
 *   features: [UsersFeature],
 *   plugins: [
 *     mcp({
 *       server: { name: 'users-service', version: '1.0.0' },
 *       converters: [zodConverter()],
 *       tools: [
 *         tool(CreateUser, { annotations: { idempotentHint: false } }),
 *         tool(GetUser, { annotations: { readOnlyHint: true } }),
 *       ],
 *     }),
 *   ],
 *   transports: [http()],
 * });
 * // POST /mcp
 * ```
 */
export function mcp<P extends AnyInput = AnyInput, PN = never>(
  options: McpOptions<P, PN>,
): Plugin {
  assertOptions(options);

  const { tools, converters, path, pipeline, detached } = options;
  const runtime = runtimeOptions(options);
  const address = path ?? DEFAULT_PATH;

  const shared = {
    ...(pipeline === undefined ? {} : { pipeline }),
    ...(detached === undefined ? {} : { detached }),
    errors: MCP_ENDPOINT_FAILS,
  };

  /** Обслуживает сообщения протокола */
  @Handler([McpTools$, McpSessions, McpOptions$])
  class MessageHandler {
    constructor(
      private readonly tools: readonly BoundTool[],
      private readonly sessions: McpSessions,
      private readonly options: McpRuntimeOptions,
    ) {}

    async handle(body: string, meta: RequestMeta) {
      const outcome = await handleMessage(
        {
          body: body ?? '',
          headers: meta.http.headers,
          signal: meta.signal,
        },
        {
          tools: this.tools,
          sessions: this.sessions,
          options: this.options,
        },
      );

      return respond(outcome);
    }
  }

  /** Закрывает сессию по запросу клиента */
  @Handler([McpSessions])
  class SessionCloseHandler {
    constructor(private readonly sessions: McpSessions) {}

    handle(_payload: unknown, meta: RequestMeta) {
      const id = meta.http.headers[SESSION_HEADER];

      if (typeof id !== 'string' || !this.sessions.close(id)) {
        return McpSessionNotFound({ sessionId: String(id ?? '') });
      }

      return Ok.noContent();
    }
  }

  const message = httpEndpoint.post(address, {
    ...shared,
    // Тело приходит текстом, а разбирает его обработчик: дефектный JSON
    // обязан стать ответом JSON-RPC с кодом ошибки разбора, а не отказом
    // ядра с телом иного вида
    input: 'text',
    doc: { hidden: 'service endpoint: the MCP protocol itself' },
    handler: MessageHandler,
  });

  const close = httpEndpoint.delete(address, {
    ...shared,
    doc: { hidden: 'service endpoint: closes an MCP session' },
    handler: SessionCloseHandler,
  });

  return makePlugin({
    name: '@nestlingjs/mcp',
    providers: [
      valueProvider(McpOptions$, runtime),
      McpSessions,
      factoryProvider(
        McpTools$,
        (...ports: Port<any>[]) =>
          bindPorts(buildToolDefinitions(tools, { converters }), ports),
        tools.map((declared) => declared.operation.caller),
      ),
    ],
    endpoints: [message, close],
  });
}
