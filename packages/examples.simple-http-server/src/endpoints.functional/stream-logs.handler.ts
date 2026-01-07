/* eslint-disable no-console */

import { makeEndpoint, stream } from '@nestling/pipeline';
import z from 'zod';

// POST /logs/stream - потоковая обработка логов
const LogChunk = z.object({
  timestamp: z.number(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});

const StreamLogsOutput = z.object({
  processed: z.number(),
  summary: z.object({
    info: z.number(),
    warn: z.number(),
    error: z.number(),
  }),
});

type LogChunk = z.infer<typeof LogChunk>;

export const StreamLogs = makeEndpoint({
  transport: 'http',
  pattern: 'POST /logs/stream',
  input: stream(LogChunk),
  output: StreamLogsOutput,
  handle: async (payload) => {
    // payload: AsyncIterableIterator<LogChunk> - тип выводится автоматически!
    const stats = { info: 0, warn: 0, error: 0 };
    let processed = 0;

    for await (const chunk of payload) {
      // Обработка каждого chunk'а лога
      stats[chunk.level]++;
      processed++;

      // В реальном приложении здесь была бы запись в базу данных
      console.log(`[${chunk.level.toUpperCase()}] ${chunk.message}`);
    }

    return {
      status: 'OK',
      value: {
        processed,
        summary: stats,
      },
    };
  },
});
