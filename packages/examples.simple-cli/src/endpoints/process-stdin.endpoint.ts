/* eslint-disable no-console */

import { EmptyStdin } from '../errors';

import type { Output } from '@nestling/pipeline';
import { makePipeline, stream } from '@nestling/pipeline';
import { cliEndpoint } from '@nestling/transport.cli';
import { z } from 'zod';

// process-stdin - обработка потоковых данных из stdin
const ProcessStdinResponse = z.object({
  linesProcessed: z.number(),
  totalBytes: z.number(),
});

type ProcessStdinResponse = z.infer<typeof ProcessStdinResponse>;

/**
 * Обрабатывает потоковые данные из stdin.
 *
 * Демонстрирует использование модификатора `stream()` в CLI.
 *
 * Использование:
 *   echo "line1\nline2\nline3" | node dist/main.js process-stdin
 */
export const ProcessStdin = cliEndpoint({
  command: 'process-stdin',
  input: stream('binary'), // Читаем stdin как поток Buffer'ов
  output: ProcessStdinResponse,
  // Объявленный отказ: без `errors:` граница пайплайна отдала бы его
  // клиенту как UNKNOWN/500
  errors: [EmptyStdin],
  pipeline: makePipeline(),
  handle: async (
    payload: AsyncIterableIterator<Buffer>,
  ): Output<ProcessStdinResponse, ReturnType<typeof EmptyStdin>> => {
    let linesProcessed = 0;
    let totalBytes = 0;

    for await (const chunk of payload) {
      totalBytes += chunk.length;

      // Подсчет строк в chunk'е
      const lines = chunk
        .toString()
        .split('\n')
        .filter((line: string) => line.trim());
      linesProcessed += lines.length;

      // Вывод обработанных строк
      for (const line of lines) {
        console.log(`Processing: ${line}`);
      }
    }

    if (totalBytes === 0) {
      return EmptyStdin();
    }

    return {
      linesProcessed,
      totalBytes,
    };
  },
});
