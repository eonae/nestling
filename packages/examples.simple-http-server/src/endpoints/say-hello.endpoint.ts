import { withStartedAt } from '../common/units';

import { makePipeline } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const SayHelloOutput = z.object({
  message: z.string(),
  startedAt: z.string(),
});

/**
 * `GET /` без `input`.
 *
 * Значение, которое положил pre-юнит, хендлер читает из второго
 * аргумента `meta`.
 */
export const SayHello = httpEndpoint({
  method: 'GET',
  path: '/',
  output: SayHelloOutput,
  pipeline: makePipeline().pre(withStartedAt),
  handle: async (_payload, meta) => ({
    message: 'Hello from Nestling',
    startedAt: new Date(meta.startedAt).toISOString(),
  }),
});
