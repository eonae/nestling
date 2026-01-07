import { makeEndpoint } from '@nestling/pipeline';
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
  handle: async () => ({
    status: 200,
    value: {
      message: 'Hello from Nestling HTTP Transport!',
      timestamp: new Date().toISOString(),
    },
    meta: {},
  }),
});
