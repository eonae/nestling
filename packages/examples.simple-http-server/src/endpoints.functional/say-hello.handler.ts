import { withTiming } from '../common/middleware';

import { makeEndpoint, makePipeline } from '@nestling/pipeline';
import z from 'zod';

// GET /
const SayHelloOutput = z.object({
  message: z.string(),
  timestamp: z.string(),
});

export const SayHello = makeEndpoint({
  transport: 'http',
  pattern: 'GET /',
  output: SayHelloOutput,
  pipeline: makePipeline().pre(withTiming),
  handle: async () => ({
    message: 'Hello from Nestling HTTP Transport!',
    timestamp: new Date().toISOString(),
  }),
});
