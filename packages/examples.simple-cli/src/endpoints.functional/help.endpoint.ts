/* eslint-disable no-console */

import { makeEndpoint } from '@nestling/pipeline';
import { z } from 'zod';

export const HelpResponse = z.object({
  message: z.string(),
});

export type HelpResponse = z.infer<typeof HelpResponse>;

export const Help = makeEndpoint({
  transport: 'cli',
  pattern: 'help',
  output: HelpResponse,
  handle: async () => {
    console.log('Available commands:');
    console.log('');
    console.log('  help');
    console.log('    Show this help message');
    console.log('    Example: yarn start help');
    console.log('');
    console.log('  process-stdin');
    console.log('    Process streaming data from stdin');
    console.log(
      String.raw`    Example: echo "line1\nline2\nline3" | yarn start process-stdin`,
    );
    console.log('');

    return {
      status: 'OK',
      value: { message: 'Help displayed' },
    };
  },
});
