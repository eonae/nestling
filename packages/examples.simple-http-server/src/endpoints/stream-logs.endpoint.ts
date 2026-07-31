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

/** Верхняя граница строк одной пачки: `.limit` отказывает 413 */
const MAX_LOG_LINES = 50_000;

/** Сколько ждём следующую строку, прежде чем отказать 504 */
const LOG_GAP_TIMEOUT = 30_000;

/**
 * Демонстрирует форму `stream(T)` на входе и item-цепочку на декларации:
 * поэлементную валидацию делает ядро, а лимит и таймаут молчания
 * действуют без единой строки в теле хендлера.
 */
export const StreamLogs = httpEndpoint({
  method: 'POST',
  path: '/logs/stream',
  input: stream(LogChunk).limit(MAX_LOG_LINES).gapTimeout(LOG_GAP_TIMEOUT),
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
