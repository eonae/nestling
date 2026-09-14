/**
 * Конверт JSON-RPC 2.0 и версии протокола MCP.
 *
 * Пакет реализует конверт сам и обслуживает пять методов: `initialize`,
 * `notifications/initialized`, `ping`, `tools/list` и `tools/call`.
 * Зависимости рантайма у этого кода нет — ни от SDK, ни от HTTP-сервера.
 */

import type { JsonValue } from './types.js';

/**
 * Версии протокола, которые пакет реализует. Первая — последняя
 * поддерживаемая: её возвращает `initialize`, когда версии клиента в
 * списке нет.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-03-26',
] as const;

/** Версия протокола из списка поддерживаемых */
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

/** Последняя поддерживаемая версия протокола */
export const LATEST_PROTOCOL_VERSION: ProtocolVersion =
  SUPPORTED_PROTOCOL_VERSIONS[0];

/** Проверяет, что версия входит в список поддерживаемых */
export function isSupportedVersion(
  version: unknown,
): version is ProtocolVersion {
  return (
    typeof version === 'string' &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)
  );
}

/**
 * Коды ошибок JSON-RPC 2.0.
 *
 * Ошибка конверта — это ошибка вызова, а не отказ инструмента. Отказ
 * операции доходит до агента результатом с `isError: true`.
 */
export const JsonRpcErrorCode = {
  /** Тело не разбирается как JSON */
  ParseError: -32_700,

  /** Тело разобрано, но это не сообщение JSON-RPC */
  InvalidRequest: -32_600,

  /** Метода нет среди обслуживаемых */
  MethodNotFound: -32_601,

  /** Параметры вызова не подходят методу */
  InvalidParams: -32_602,

  /** Сервер не смог обработать корректный вызов */
  InternalError: -32_603,
} as const;

/** Код ошибки JSON-RPC */
export type JsonRpcErrorCode =
  (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];

/** Идентификатор сообщения: строка или число */
export type JsonRpcId = string | number;

/** Сообщение клиента: запрос с `id` или нотификация без него */
export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Успешный ответ на запрос.
 *
 * `result` типизирован словарём неизвестных значений: его состав задаёт
 * метод, а наружу он уходит через `JSON.stringify`.
 */
export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: Record<string, unknown>;
}

/** Ответ с ошибкой протокола */
export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: {
    code: number;
    message: string;
    data?: JsonValue;
  };
}

/** Ответ на запрос: успех или ошибка протокола */
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** Собирает успешный ответ */
export function jsonRpcResult(
  id: JsonRpcId,
  result: Record<string, unknown>,
): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Собирает ответ с ошибкой протокола.
 *
 * `id` равен `null`, когда прочитать его из сообщения не удалось: тело не
 * разобралось или оказалось не объектом.
 */
export function jsonRpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: JsonValue,
): JsonRpcFailure {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/** Результат разбора тела запроса */
export type ParsedMessage =
  | { readonly ok: true; readonly message: JsonRpcMessage }
  | { readonly ok: false; readonly response: JsonRpcFailure };

/** Читает `id` из тела, которое ещё не признано сообщением JSON-RPC */
function idOf(body: unknown): JsonRpcId | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const id = (body as { id?: unknown }).id;

  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

/**
 * Разбирает тело запроса в сообщение JSON-RPC.
 *
 * Пачек сообщений endpoint не принимает: массив отвергается как
 * некорректный запрос.
 *
 * @param body - Тело запроса текстом
 * @returns Сообщение либо готовый ответ с кодом ошибки протокола
 */
export function parseMessage(body: string): ParsedMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return {
      ok: false,
      response: jsonRpcError(
        null,
        JsonRpcErrorCode.ParseError,
        `Request body is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      response: jsonRpcError(
        idOf(parsed),
        JsonRpcErrorCode.InvalidRequest,
        'Request body must be a single JSON-RPC message object. ' +
          'Batches are not accepted.',
      ),
    };
  }

  const message = parsed as Record<string, unknown>;

  if (message.jsonrpc !== '2.0') {
    return {
      ok: false,
      response: jsonRpcError(
        idOf(parsed),
        JsonRpcErrorCode.InvalidRequest,
        `Field 'jsonrpc' must be '2.0', got ${JSON.stringify(
          message.jsonrpc,
        )}.`,
      ),
    };
  }

  if (typeof message.method !== 'string') {
    return {
      ok: false,
      response: jsonRpcError(
        idOf(parsed),
        JsonRpcErrorCode.InvalidRequest,
        "Field 'method' is required and must be a string.",
      ),
    };
  }

  const id = idOf(parsed);
  const params =
    typeof message.params === 'object' &&
    message.params !== null &&
    !Array.isArray(message.params)
      ? (message.params as Record<string, unknown>)
      : undefined;

  return {
    ok: true,
    message: {
      jsonrpc: '2.0',
      method: message.method,
      ...(id !== null && { id }),
      ...(params !== undefined && { params }),
    },
  };
}
