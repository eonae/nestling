import { makeHandler } from '@nestling/pipeline';
import z from 'zod';

// GET /
const SayHelloResponse = z.object({
  message: z.string(),
  timestamp: z.string(),
});

export const SayHelloHandler = makeHandler({
  transport: 'http',
  pattern: 'GET /',
  responseSchema: SayHelloResponse,
  handle: async () => ({
    status: 200,
    value: {
      message: 'Hello from Nestling HTTP Transport!',
      timestamp: new Date().toISOString(),
    },
    meta: {},
  }),
});
