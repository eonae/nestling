/* eslint-disable no-console */

import { cliEndpoint } from '@nestling/transport.cli';
import { z } from 'zod';

const HelpOutput = z.object({
  message: z.string(),
});

/** `help`: печатает список команд */
export const Help = cliEndpoint({
  command: 'help',
  output: HelpOutput,
  handler: async () => {
    console.log('Available commands:');
    console.log('');
    console.log('  help');
    console.log('    Show this help message');
    console.log('');
    console.log('  greet <name> [--shout]');
    console.log('    Print a greeting');
    console.log(
      '    Example: yarn workspace examples.simple-cli start:dev greet Alice --shout',
    );
    console.log('');
    console.log('  process-stdin');
    console.log('    Count lines and bytes read from stdin');
    console.log(
      String.raw`    Example: printf "a\nb\n" | yarn workspace examples.simple-cli start:dev process-stdin`,
    );
    console.log('');

    return { message: 'Help displayed' };
  },
});
