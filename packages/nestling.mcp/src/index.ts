/**
 * `@nestlingjs/mcp` — MCP транспортом Nestling.
 *
 * Агент присылает запрос, сервер выбирает маршрут, исполняет его
 * пайплайном и отвечает: это работа транспорта, и объявляется он в
 * `transports:` корня рядом с `http()`. Второго сокета не появляется —
 * обработчик встаёт в цепочку уже объявленного HTTP-сервера.
 *
 * Инструмент — endpoint этого транспорта. Форм две, как у всех
 * транспортов: `mcpTool('search_users', { … })` объявляет инструмент
 * вместе со схемами, `mcpTool.implement(CreateUser, { … })` обслуживает
 * уже объявленную операцию. Отдельного списка состава нет: инструменты
 * видны там же, где endpoint'ы любого другого транспорта, — в `endpoints:`
 * фич.
 *
 * Зависимости от валидатора у пакета нет: перевод схемы в JSON Schema
 * приходит **данными** — списком `SchemaDocConverter`, тем же, который
 * принимает генератор OpenAPI.
 *
 * Барель перечисляет имена поимённо: имя, которого здесь нет, остаётся
 * внутренним. Полный перечень с разбивкой — в README пакета.
 */

// ./transport.js — 4
export { mcp, MCP_CAPABILITIES, McpTransport } from './transport.js';
export type { McpTransportOptions } from './transport.js';

// ./token.js — 2
export { MCP_TRANSPORT_NAME, McpTransport$ } from './token.js';

// ./tool.js — 6
export { deriveToolName, mcpBindingOf, mcpTool } from './tool.js';
export type {
  AnyRequestOperation,
  McpBinding,
  McpImplementDictionary,
  McpToolDictionary,
} from './tool.js';

// ./definitions.js — 3
export { buildToolDefinitions } from './definitions.js';
export type { BoundTool, BuildOptions } from './definitions.js';

// ./diagnostics.js — 1
export type { McpViolation } from './diagnostics.js';

// ./errors.js — 2
export { McpSessionLimitReached, McpSessionNotFound } from './errors.js';

// ./options.js — 4
export {
  DEFAULT_PATH,
  DEFAULT_SESSION_IDLE_MS,
  DEFAULT_SESSION_LIMIT,
} from './options.js';
export type { McpRuntimeOptions } from './options.js';

// ./protocol.js — 3
export {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './protocol.js';
export type { ProtocolVersion } from './protocol.js';

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
