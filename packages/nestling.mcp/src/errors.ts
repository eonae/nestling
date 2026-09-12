/**
 * Отказы endpoint'а плагина.
 *
 * Endpoint отвечает отказом там, где сообщения протокола ещё нет: клиент
 * назвал закрытую сессию, открыл сессий больше разрешённого или прислал
 * версию протокола, которой пакет не реализует. Отказ инструмента этими
 * определениями не описывается: он приходит агенту результатом вызова.
 *
 * Схемы деталей написаны вручную и аннотированы объявленной JSON Schema —
 * тем же приёмом, которым объявлены отказы ядра. Зависимости от валидатора
 * у пакета нет, а описать детали нужно.
 */

import { jsonSchema, makeFail } from '@nestlingjs/app';
import type { StandardSchemaV1 } from '@nestlingjs/operations';

/** Схема объекта с одним строковым полем */
function stringFieldSchema<K extends string>(
  field: K,
): StandardSchemaV1<unknown, Record<K, string>> {
  const schema: StandardSchemaV1<unknown, Record<K, string>> = {
    '~standard': {
      version: 1,
      vendor: 'nestling',
      validate: (value) => {
        const candidate = (value as Record<string, unknown> | undefined)?.[
          field
        ];

        return typeof candidate === 'string'
          ? { value: { [field]: candidate } as Record<K, string> }
          : { issues: [{ message: `Expected \`${field}\` to be a string` }] };
      },
    },
  };

  return jsonSchema(schema, {
    type: 'object',
    properties: { [field]: { type: 'string' } },
    required: [field],
  });
}

/** Схема объекта с одним числовым полем */
function numberFieldSchema<K extends string>(
  field: K,
): StandardSchemaV1<unknown, Record<K, number>> {
  const schema: StandardSchemaV1<unknown, Record<K, number>> = {
    '~standard': {
      version: 1,
      vendor: 'nestling',
      validate: (value) => {
        const candidate = (value as Record<string, unknown> | undefined)?.[
          field
        ];

        return typeof candidate === 'number'
          ? { value: { [field]: candidate } as Record<K, number> }
          : { issues: [{ message: `Expected \`${field}\` to be a number` }] };
      },
    },
  };

  return jsonSchema(schema, {
    type: 'object',
    properties: { [field]: { type: 'number' } },
    required: [field],
  });
}

/**
 * Сессия закрыта или её не было.
 *
 * Клиент открывает новую сообщением `initialize`.
 */
export const McpSessionNotFound = makeFail('not_found:mcp_session', {
  details: stringFieldSchema('sessionId'),
  message: (d) =>
    `MCP session '${d.sessionId}' is closed or unknown. Send 'initialize' ` +
    `to open a new one.`,
});

/** Открытых сессий столько же, сколько разрешено опцией `sessionLimit` */
export const McpSessionLimitReached = makeFail(
  'too_many_requests:mcp_sessions',
  {
    details: numberFieldSchema('limit'),
    message: (d) =>
      `The server already holds ${d.limit} open MCP session(s), which is ` +
      `the declared limit. Close a session with DELETE on the endpoint ` +
      `path, or raise 'sessionLimit' in the mcp(...) options.`,
  },
);

/** Отказы, которые объявляет endpoint плагина */
export const MCP_ENDPOINT_FAILS = [
  McpSessionNotFound,
  McpSessionLimitReached,
] as const;
