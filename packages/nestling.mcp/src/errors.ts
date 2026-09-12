/**
 * Отказы транспорта: то, чем он отвечает до сообщения протокола.
 *
 * Транспорт отвечает отказом там, где обслуживать сообщение ещё не из
 * чего: клиент назвал закрытую сессию, открыл сессий больше разрешённого
 * или прислал версию протокола, которой пакет не реализует. Отказ
 * инструмента этими определениями не описывается: он приходит агенту
 * результатом вызова.
 *
 * Схемы деталей написаны вручную: зависимости от валидатора у пакета нет,
 * а проверить детали при создании отказа нужно.
 */

import { makeFail } from '@nestlingjs/app';
import type { StandardSchemaV1 } from '@nestlingjs/operations';

/**
 * Схема объекта с одним полем известного типа.
 *
 * Одна на все отказы пакета: деталей у них по одному полю, и вторая копия
 * этой проверки разошлась бы с первой.
 */
function singleField<K extends string, V>(
  field: K,
  expected: 'number' | 'string',
): StandardSchemaV1<unknown, Record<K, V>> {
  return {
    '~standard': {
      version: 1,
      vendor: 'nestling',
      validate: (value) => {
        const candidate = (value as Record<string, unknown> | undefined)?.[
          field
        ];

        return typeof candidate === expected
          ? { value: { [field]: candidate } as Record<K, V> }
          : {
              issues: [
                { message: `Expected \`${field}\` to be a ${expected}` },
              ],
            };
      },
    },
  };
}

/**
 * Сессия закрыта или её не было.
 *
 * Клиент открывает новую сообщением `initialize`.
 */
export const McpSessionNotFound = makeFail('not_found:mcp_session', {
  details: singleField<'sessionId', string>('sessionId', 'string'),
  message: (d) =>
    `MCP session '${d.sessionId}' is closed or unknown. Send 'initialize' ` +
    `to open a new one.`,
});

/** Открытых сессий столько же, сколько разрешено опцией `sessionLimit` */
export const McpSessionLimitReached = makeFail(
  'too_many_requests:mcp_sessions',
  {
    details: singleField<'limit', number>('limit', 'number'),
    message: (d) =>
      `The server already holds ${d.limit} open MCP session(s), which is ` +
      `the declared limit. Close a session with DELETE on the transport ` +
      `path, or raise 'sessionLimit' in the mcp(...) options.`,
  },
);
