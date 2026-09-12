/**
 * `@nestlingjs/mcp` — сервер MCP из деклараций операций.
 *
 * Инструмент агента объявляется значением: `tool(Operation, { … })` читает
 * имя, схемы, отказы и секцию `doc` операции, а словарь добавляет то, что
 * нужно агенту и чего в API нет. Список `tools:` плагина `mcp(...)` —
 * единственный источник состава.
 *
 * Плагин ставит два endpoint'а на уже объявленный HTTP-транспорт: `POST`
 * для сообщений протокола и `DELETE` для закрытия сессии. Второго сервера
 * и второго порта не появляется.
 *
 * Зависимости от валидатора у пакета нет: перевод схемы в JSON Schema
 * приходит **данными** — списком `SchemaDocConverter`, тем же, который
 * принимает генератор OpenAPI.
 *
 * Барель перечисляет имена поимённо: имя, которого здесь нет, остаётся
 * внутренним. Полный перечень с разбивкой — в README пакета.
 */

// ./definitions.js — 3
export { buildToolDefinitions } from './definitions.js';
export type { BoundToolDefinition, BuildOptions } from './definitions.js';

// ./diagnostics.js — 1
export type { McpViolation } from './diagnostics.js';

// ./errors.js — 2
export { McpSessionLimitReached, McpSessionNotFound } from './errors.js';

// ./handler.js — 6
export { handleMessage, SESSION_HEADER, VERSION_HEADER } from './handler.js';
export type { BoundTool, McpContext, McpOutcome, McpRequest } from './handler.js';

// ./options.js — 6
export {
  DEFAULT_PATH,
  DEFAULT_SESSION_IDLE_MS,
  DEFAULT_SESSION_LIMIT,
  McpOptions$,
} from './options.js';
export type { McpRuntimeOptions } from './options.js';

// ./plugin.js — 3
export { mcp, McpTools$ } from './plugin.js';
export type { McpOptions } from './plugin.js';

// ./protocol.js — 6
export {
  JsonRpcErrorCode,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './protocol.js';
export type {
  JsonRpcMessage,
  JsonRpcResponse,
  ProtocolVersion,
} from './protocol.js';

// ./sessions.js — 3
export { McpSessions } from './sessions.js';
export type { McpClientInfo, McpSession } from './sessions.js';

// ./tool.js — 4
export { tool } from './tool.js';
export type {
  AnyRequestOperation,
  DeclaredTool,
  McpToolOptions,
} from './tool.js';

// ./types.js — 6
export type {
  McpCallToolResult,
  McpContent,
  McpObjectSchema,
  McpServerInfo,
  McpToolAnnotations,
  McpToolDefinition,
} from './types.js';

/**
 * Интерфейс вендор-конвертера — реэкспорт схемного слоя.
 *
 * Автор своего конвертера пишет его против того же типа, который принимает
 * генератор OpenAPI: тип один на обоих потребителей.
 */
export type { SchemaDocConverter } from '@nestlingjs/app';
