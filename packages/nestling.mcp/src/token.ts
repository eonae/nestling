/**
 * DI-токен транспорта MCP и его короткое имя.
 *
 * Отдельный модуль, потому что DI-токен читают обе стороны: декларация
 * инструмента (`mcpTool`) называет им транспорт, а транспорт берёт по
 * нему своё имя для контекста запроса. Общий файл замкнул бы их друг на
 * друга.
 */

import type { ITransport } from '@nestlingjs/app';
import { DEFAULT_INSTANCE, transportNameOf } from '@nestlingjs/app';
import { makeTokenFamily } from '@nestlingjs/container';

/**
 * Семейство DI-токенов транспорта MCP: один член на экземпляр.
 *
 * Им ссылается на транспорт каждая декларация инструмента; `App` берёт по
 * нему экземпляр из графа. Декларация выбирает экземпляр через `on:`; без
 * него это `'default'`.
 */
export const McpTransport$ = makeTokenFamily<ITransport, [instance: string]>(
  'transport:mcp',
);

/** Короткое имя транспорта (`'mcp'`) — то же, что читают слои пайплайна */
export const MCP_TRANSPORT_NAME = transportNameOf(
  McpTransport$(DEFAULT_INSTANCE),
);
