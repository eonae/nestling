import { httpEndpoint } from '@nestlingjs/transport.http';
import { z } from 'zod';

/**
 * Версия сборки для эксплуатации.
 *
 * `detached` выводит endpoint из-под политик сборки с указанием причины.
 * `doc.hidden` убирает его из документа OpenAPI, тоже с причиной.
 */
export const BuildInfo = httpEndpoint.get('/ops/version', {
  output: z.object({ version: z.string() }),
  detached:
    'служебный endpoint эксплуатации: строка аудита на каждый опрос заслоняет полезные записи',
  doc: { hidden: 'служебный endpoint, не часть публичного API' },
  handler: async () => ({ version: process.env.BUILD_VERSION ?? 'dev' }),
});
