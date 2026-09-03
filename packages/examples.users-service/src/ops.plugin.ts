import { makePlugin } from '@nestling/app';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

/**
 * Проба живости для балансировщика.
 *
 * `detached` выводит endpoint из-под политик сборки с указанием причины.
 * `doc.hidden` убирает его из документа OpenAPI, тоже с причиной.
 */
export const CheckHealth = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: z.object({ status: z.string() }),
  detached:
    'проба балансировщика: строка аудита на каждый запрос заслоняет полезные записи',
  doc: { hidden: 'служебная проба, не часть публичного API' },
  handler: async () => ({ status: 'up' }),
});

/**
 * Плагин эксплуатации: служебные endpoint'ы, которые есть в каждом
 * процессе. Плагин подключён всегда и в выборе фич не участвует.
 */
export const ops = makePlugin({
  name: 'ops',
  endpoints: [CheckHealth],
});
