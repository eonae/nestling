import { defineHandler } from '@nestling/transport';
import z from 'zod';

// GET /
const HelloResponseSchema = z.object({
  message: z.string(),
  timestamp: z.string(),
});

export const SayHello = defineHandler({
  transport: 'http',
  method: 'GET',
  path: '/',
  responseSchema: HelloResponseSchema,
  handler: async () => ({
    status: 200,
    value: {
      message: 'Hello from Nestling HTTP Transport!',
      timestamp: new Date().toISOString(),
    },
    meta: {},
  }),
});
