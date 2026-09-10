import { makePlugin } from '@nestlingjs/app';
import { httpEndpoint, httpProbes } from '@nestlingjs/transport.http';
import { z } from 'zod';

/**
 * Версия сборки для эксплуатации.
 *
 * `detached` выводит endpoint из-под политик сборки с указанием причины.
 * `doc.hidden` убирает его из документа OpenAPI, тоже с причиной.
 */
export const BuildInfo = httpEndpoint({
  method: 'GET',
  path: '/ops/version',
  output: z.object({ version: z.string() }),
  detached:
    'служебный endpoint эксплуатации: строка аудита на каждый опрос заслоняет полезные записи',
  doc: { hidden: 'служебный endpoint, не часть публичного API' },
  handler: async () => ({ version: process.env.BUILD_VERSION ?? 'dev' }),
});

/**
 * Плагин эксплуатации: служебные endpoint'ы, которые есть в каждом
 * процессе. Плагин подключён всегда и в выборе фич не участвует.
 *
 * Пробы живости и готовности он не пишет сам: их даёт `httpProbes()`
 * поверх узла ядра `Health$`.
 */
export const ops = makePlugin({
  name: 'ops',
  endpoints: [BuildInfo],
  dependsOn: [httpProbes()],
});
