/**
 * Обработчик сообщений протокола: пять методов и конверт JSON-RPC.
 *
 * Функция принимает тело запроса с заголовками и возвращает то, чем на
 * него отвечать. HTTP она не знает: кадрированием ответа занимается
 * транспорт, и обработчик проверяется без поднятия приложения.
 */

import type { BoundTool } from './definitions.js';
import { McpSessionLimitReached, McpSessionNotFound } from './errors.js';
import type { McpRuntimeOptions } from './options.js';
import type { JsonRpcId, JsonRpcResponse } from './protocol.js';
import {
  isSupportedVersion,
  jsonRpcError,
  JsonRpcErrorCode,
  jsonRpcResult,
  LATEST_PROTOCOL_VERSION,
  parseMessage,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './protocol.js';
import { toCallToolResult } from './result.js';
import type { McpSessions } from './sessions.js';
import { McpSessionLimitError } from './sessions.js';
import { MCP_TRANSPORT_NAME } from './token.js';

import type { AnyFail, Dispatch, EndpointMeta, Raw } from '@nestlingjs/app';
import { Fail, makeEmptyContext } from '@nestlingjs/app';

/** Заголовок с идентификатором сессии */
export const SESSION_HEADER = 'mcp-session-id';

/** Заголовок с версией протокола */
export const VERSION_HEADER = 'mcp-protocol-version';

/**
 * Методы, которым нужна открытая сессия.
 *
 * `initialize` сессию заводит, `ping` отвечает на любой стадии, а
 * `notifications/initialized` доходит до сервера сразу за `initialize`.
 * Сессия нужна там, где ответ зависит от состава инструментов.
 */
const SESSION_METHODS = new Set(['tools/call', 'tools/list']);

/** Запрос к транспорту: тело, заголовки и сигнал отмены */
export interface McpRequest {
  /** Тело запроса текстом; разбирает его обработчик */
  readonly body: string;

  /** Заголовки запроса; имена в нижнем регистре */
  readonly headers: Readonly<Record<string, unknown>>;

  /** Сигнал отмены запроса: доходит до хендлера через контекст */
  readonly signal: AbortSignal;
}

/** Что транспорт должен отправить в ответ */
export type McpOutcome =
  /** Ответ JSON-RPC со статусом `ok`; `sessionId` уходит заголовком */
  | {
      readonly kind: 'response';
      readonly body: JsonRpcResponse;
      readonly sessionId?: string;
    }
  /** Нотификация принята: статус `accepted` без тела */
  | { readonly kind: 'accepted' }
  /** Запрос закрыл сессию: статус `no_content` без тела */
  | { readonly kind: 'closed' }
  /** Отказ транспорта: сообщения протокола в ответе нет */
  | { readonly kind: 'fail'; readonly fail: AnyFail };

/** Всё, из чего обработчик исполняет сообщение */
export interface McpContext {
  /** Инструменты с готовыми определениями; построены в `serve` */
  readonly tools: readonly BoundTool[];

  /** Карта сессий транспорта */
  readonly sessions: McpSessions;

  /** Опции транспорта после нормализации */
  readonly options: McpRuntimeOptions;

  /** Маршруты транспорта и исполнение endpoint'а */
  readonly dispatch: Dispatch;
}

/** Читает заголовок запроса строкой */
function headerOf(
  headers: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  const value = headers[name];

  return typeof value === 'string' ? value : undefined;
}

/**
 * Сверяет заголовок версии протокола.
 *
 * Заголовка нет — сверять нечего: его не шлют до `initialize`.
 *
 * @returns Отказ либо `undefined`, если версия поддерживается
 */
function checkVersion(request: McpRequest): AnyFail | undefined {
  const declared = headerOf(request.headers, VERSION_HEADER);

  if (declared === undefined || isSupportedVersion(declared)) {
    return undefined;
  }

  return Fail.badRequest(
    `Header '${VERSION_HEADER}: ${declared}' names a protocol version this ` +
      `server does not implement. Supported versions are ` +
      `${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}.`,
  );
}

/** Сведения о клиенте из параметров `initialize` */
function clientInfoOf(params: Record<string, unknown> | undefined): {
  name?: string;
  version?: string;
} {
  const info = params?.clientInfo;

  if (typeof info !== 'object' || info === null) {
    return {};
  }

  const { name, version } = info as { name?: unknown; version?: unknown };

  return {
    ...(typeof name === 'string' && { name }),
    ...(typeof version === 'string' && { version }),
  };
}

/**
 * Согласует версию протокола.
 *
 * Версия клиента берётся, если пакет её реализует; иначе в ответ уходит
 * последняя поддерживаемая, и дальше решает клиент.
 */
function negotiate(params: Record<string, unknown> | undefined) {
  const requested = params?.protocolVersion;

  return isSupportedVersion(requested) ? requested : LATEST_PROTOCOL_VERSION;
}

/** Обслуживает `initialize`: заводит сессию и отвечает сведениями о сервере */
function initialize(
  id: JsonRpcId,
  params: Record<string, unknown> | undefined,
  context: McpContext,
): McpOutcome {
  const version = negotiate(params);

  let sessionId: string;

  try {
    sessionId = context.sessions.open(version, clientInfoOf(params)).id;
  } catch (error) {
    if (error instanceof McpSessionLimitError) {
      return {
        kind: 'fail',
        fail: McpSessionLimitReached({ limit: error.limit }),
      };
    }
    throw error;
  }

  return {
    kind: 'response',
    sessionId,
    body: jsonRpcResult(id, {
      protocolVersion: version,
      // Объявлен один `tools`: ресурсов, промптов и логирования по
      // протоколу пакет не отдаёт
      capabilities: { tools: {} },
      serverInfo: { ...context.options.info },
    }),
  };
}

/**
 * Обслуживает `tools/call`: находит инструмент и исполняет его декларацию.
 *
 * Второго пути исполнения у пакета нет: инструмент проходит пайплайн своей
 * декларации, её слои и её политики — тем же `dispatch.call`, каким HTTP
 * исполняет свой endpoint.
 */
async function callTool(
  id: JsonRpcId,
  params: Record<string, unknown> | undefined,
  context: McpContext,
  request: McpRequest,
): Promise<McpOutcome> {
  const name = params?.name;

  if (typeof name !== 'string') {
    return {
      kind: 'response',
      body: jsonRpcError(
        id,
        JsonRpcErrorCode.InvalidParams,
        "Parameter 'name' is required and must be a string.",
      ),
    };
  }

  const found = context.tools.find((item) => item.definition.name === name);

  if (found === undefined) {
    return {
      kind: 'response',
      body: jsonRpcError(
        id,
        JsonRpcErrorCode.InvalidParams,
        `Unknown tool '${name}'. Call tools/list to see the tools this ` +
          `server exposes.`,
      ),
    };
  }

  const raw: Raw = {
    transport: MCP_TRANSPORT_NAME,
    pattern: found.pattern,
    // Вход проверяет рантайм пайплайна схемой декларации: непрошедшие
    // аргументы возвращаются отказом `bad_request`, и агент читает его
    // результатом вызова
    payload: params?.arguments,
    attributes: { ...request.headers },
  };

  const endpoint: EndpointMeta = {
    transport: MCP_TRANSPORT_NAME,
    pattern: found.pattern,
    input: found.route.input,
    output: found.route.output,
    // Объявленные отказы попадают в проверку границы только так:
    // декларация → транспорт → контекст, без глобального реестра
    errors: found.route.errors,
  };

  const response = await context.dispatch.call(
    found.pattern,
    makeEmptyContext(raw, endpoint, request.signal),
  );

  return {
    kind: 'response',
    body: jsonRpcResult(id, toCallToolResult(response, found.structured)),
  };
}

/**
 * Закрывает сессию по запросу клиента.
 *
 * Сообщения протокола у такого запроса нет: клиент сообщает о закрытии
 * методом запроса и заголовком сессии.
 *
 * @param request - Заголовки запроса; тело не читается
 * @param context - Карта сессий транспорта
 */
export function closeSession(
  request: McpRequest,
  context: McpContext,
): McpOutcome {
  const declared = headerOf(request.headers, SESSION_HEADER);

  if (declared === undefined || !context.sessions.close(declared)) {
    return {
      kind: 'fail',
      fail: McpSessionNotFound({ sessionId: declared ?? '' }),
    };
  }

  return { kind: 'closed' };
}

/**
 * Исполняет одно сообщение протокола.
 *
 * @param request - Тело запроса, заголовки и сигнал отмены
 * @param context - Инструменты, карта сессий, опции и диспетчер
 * @returns Ответ JSON-RPC, принятая нотификация либо отказ транспорта
 */
export async function handleMessage(
  request: McpRequest,
  context: McpContext,
): Promise<McpOutcome> {
  const parsed = parseMessage(request.body);

  if (!parsed.ok) {
    return { kind: 'response', body: parsed.response };
  }

  const { id, method, params } = parsed.message;

  const versionFail = checkVersion(request);
  if (versionFail) {
    return { kind: 'fail', fail: versionFail };
  }

  if (SESSION_METHODS.has(method)) {
    const declared = headerOf(request.headers, SESSION_HEADER);

    if (declared === undefined) {
      return {
        kind: 'fail',
        fail: Fail.badRequest(
          `Header '${SESSION_HEADER}' is required for '${method}'. Send ` +
            `'initialize' first and pass back the session id it returns.`,
        ),
      };
    }

    if (context.sessions.get(declared) === undefined) {
      return {
        kind: 'fail',
        fail: McpSessionNotFound({ sessionId: declared }),
      };
    }
  }

  // Нотификация: сообщение без `id`. Единственная, которую шлёт клиент, —
  // `notifications/initialized`; остальные принимаются и не обрабатываются
  if (id === undefined) {
    return { kind: 'accepted' };
  }

  switch (method) {
    case 'initialize': {
      return initialize(id, params, context);
    }
    case 'ping': {
      return { kind: 'response', body: jsonRpcResult(id, {}) };
    }
    case 'tools/list': {
      // Страничного перебора нет: список известен целиком с `serve` и во
      // время работы не меняется
      return {
        kind: 'response',
        body: jsonRpcResult(id, {
          tools: context.tools.map((item) => item.definition),
        }),
      };
    }
    case 'tools/call': {
      return callTool(id, params, context, request);
    }
    default: {
      return {
        kind: 'response',
        body: jsonRpcError(
          id,
          JsonRpcErrorCode.MethodNotFound,
          `Method '${method}' is not implemented. This server serves ` +
            `initialize, notifications/initialized, ping, tools/list and ` +
            `tools/call.`,
        ),
      };
    }
  }
}
