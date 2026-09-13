/**
 * Отказы транспорта: то, чем он отвечает до сообщения протокола.
 *
 * Транспорт отвечает отказом там, где обслуживать сообщение ещё не из
 * чего: клиент назвал закрытую сессию, открыл сессий больше разрешённого
 * или прислал версию протокола, которой пакет не реализует. Отказ
 * инструмента этими определениями не описывается: он приходит агенту
 * результатом вызова.
 */

import { makeFail } from '@nestlingjs/app';
import { z } from 'zod';

/**
 * Сессия закрыта или её не было.
 *
 * Клиент открывает новую сообщением `initialize`.
 */
export const McpSessionNotFound = makeFail('not_found:mcp_session', {
  details: z.object({ sessionId: z.string() }),
  message: (d) =>
    `MCP session '${d.sessionId}' is closed or unknown. Send 'initialize' ` +
    `to open a new one.`,
});

/** Открытых сессий столько же, сколько разрешено опцией `sessionLimit` */
export const McpSessionLimitReached = makeFail(
  'too_many_requests:mcp_sessions',
  {
    details: z.object({ limit: z.number() }),
    message: (d) =>
      `The server already holds ${d.limit} open MCP session(s), which is ` +
      `the declared limit. Close a session with DELETE on the transport ` +
      `path, or raise 'sessionLimit' in the mcp(...) options.`,
  },
);
