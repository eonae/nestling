/* eslint-disable no-console */

import { withTiming } from '../common/middleware';

import { makePipeline, stream } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import z from 'zod';

const LogLevel = z.enum(['info', 'warn', 'error']);

// POST /logs/stream - потоковая обработка логов
const LogChunk = z.object({
  timestamp: z.number(),
  level: LogLevel,
  message: z.string(),
});

const StreamLogsOutput = z.object({
  processed: z.number(),
  summary: z.record(LogLevel, z.number()),
});

type LogChunk = z.infer<typeof LogChunk>;
type StreamLogsOutput = z.infer<typeof StreamLogsOutput>;

export const StreamLogs = httpEndpoint({
  method: 'POST',
  path: '/logs/stream',
  input: stream(LogChunk),
  output: StreamLogsOutput,
  pipeline: makePipeline().pre(withTiming),
  handle: async (
    payload: AsyncIterableIterator<LogChunk>,
  ): Promise<StreamLogsOutput> => {
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
      processed,
      summary: stats,
    };
  },
});
