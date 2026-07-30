import { withTiming } from '../common/middleware';

import { makePipeline } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import z from 'zod';

// GET /
const SayHelloOutput = z.object({
  message: z.string(),
  timestamp: z.string(),
});

export const SayHello = httpEndpoint({
  method: 'GET',
  path: '/',
  output: SayHelloOutput,
  pipeline: makePipeline().pre(withTiming),
  handle: async () => ({
    message: 'Hello from Nestling HTTP Transport!',
    timestamp: new Date().toISOString(),
  }),
});
