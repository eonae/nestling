/* eslint-disable no-console */

import { makeEndpoint, stream } from '@nestling/pipeline';
import { z } from 'zod';

// process-stdin - обработка потоковых данных из stdin
const ProcessStdinResponse = z.object({
  linesProcessed: z.number(),
  totalBytes: z.number(),
});

type ProcessStdinResponse = z.infer<typeof ProcessStdinResponse>;

/**
 * Handler для обработки streaming данных из stdin
 * Демонстрирует использование stream() модификатора в CLI
 *
 * Использование:
 *   echo "line1\nline2\nline3" | node dist/main.js process-stdin
 */
export const ProcessStdin = makeEndpoint({
  transport: 'cli',
  pattern: 'process-stdin',
  input: stream('binary'), // Читаем stdin как поток Buffer'ов
  output: ProcessStdinResponse,
  handle: async (payload) => {
    // payload: AsyncIterableIterator<Buffer> - тип выводится автоматически!
    let linesProcessed = 0;
    let totalBytes = 0;

    for await (const chunk of payload) {
      totalBytes += chunk.length;

      // Подсчет строк в chunk'е
      const lines = chunk
        .toString()
        .split('\n')
        .filter((line) => line.trim());
      linesProcessed += lines.length;

      // Вывод обработанных строк
      for (const line of lines) {
        console.log(`Processing: ${line}`);
      }
    }

    return {
      status: 0,
      value: {
        linesProcessed,
        totalBytes,
      },
      meta: {},
    };
  },
});
