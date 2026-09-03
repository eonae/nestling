import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

/**
 * Проба живости для балансировщика.
 *
 * `detached` выводит endpoint из-под политик сборки с указанием причины.
 * Причина печатается на старте и попадает в отчёт `check()`. `doc.hidden`
 * убирает endpoint из документа OpenAPI, тоже с причиной.
 */
export const Health = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: z.object({ status: z.string() }),
  detached:
    'проба балансировщика: строка аудита на каждый запрос заслоняет полезные записи',
  doc: { hidden: 'служебная проба, не часть публичного API' },
  handle: async () => ({ status: 'up' }),
});
