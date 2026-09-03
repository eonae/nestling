/**
 * Фикстура: тип-меняющий шаг item-цепочки в слоте `output`.
 *
 * Оба конца выходного потока зафиксированы схемой, поэтому `.batch(...)`
 * там нелегален. Диагностика обязана называть правило, а не разворачивать
 * трассировку дженериков формы.
 */

import { makePipeline, Ok, stream } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const Row = z.object({ id: z.string() });

export const ExportRows = httpEndpoint({
  method: 'GET',
  path: '/rows',
  output: stream(Row).batch(100),
  pipeline: makePipeline(),
  handler: async () => new Ok((async function* () {})()),
});
