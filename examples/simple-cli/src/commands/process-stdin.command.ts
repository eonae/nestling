/* eslint-disable no-console */

import { EmptyStdin } from '../errors.js';

import { stream } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { cliEndpoint } from '@nestling/transport.cli';
import { z } from 'zod';

const ProcessStdinOutput = z.object({
  linesProcessed: z.number(),
  totalBytes: z.number(),
});

type ProcessStdinOutput = z.infer<typeof ProcessStdinOutput>;

/**
 * `process-stdin`: читает stdin как поток байтов и считает строки.
 *
 * Запуск:
 *   printf "a\nb\n" | yarn workspace @examples/simple-cli start:dev process-stdin
 */
export const ProcessStdin = cliEndpoint({
  command: 'process-stdin',
  input: stream('binary'),
  output: ProcessStdinOutput,
  errors: [EmptyStdin],
  handler: async (
    payload: AsyncIterableIterator<Buffer>,
  ): Output<ProcessStdinOutput, typeof EmptyStdin> => {
    let linesProcessed = 0;
    let totalBytes = 0;

    for await (const chunk of payload) {
      totalBytes += chunk.length;

      const lines = chunk
        .toString()
        .split('\n')
        .filter((line: string) => line.trim());
      linesProcessed += lines.length;

      for (const line of lines) {
        console.log(`Processing: ${line}`);
      }
    }

    if (totalBytes === 0) {
      return EmptyStdin();
    }

    return { linesProcessed, totalBytes };
  },
});
