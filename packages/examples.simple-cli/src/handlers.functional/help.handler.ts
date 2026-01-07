/* eslint-disable no-console */

import { makeHandler } from '@nestling/pipeline';
import { z } from 'zod';

export const HelpResponseSchema = z.object({
  message: z.string(),
});

export type HelpResponse = z.infer<typeof HelpResponseSchema>;

export const Help = makeHandler({
  transport: 'cli',
  pattern: 'help',
  responseSchema: HelpResponseSchema,
  handle: async () => {
    console.log('Available commands:');
    console.log('');
    console.log('  greet [name] [--enthusiastic]');
    console.log('    Greet someone');
    console.log('    Example: yarn start greet Alice --enthusiastic');
    console.log('');
    console.log('  greet-schema [name] [--enthusiastic]');
    console.log('    Greet someone (with schema validation)');
    console.log('    Example: yarn start greet-schema Alice --enthusiastic');
    console.log('');
    console.log('  info');
    console.log('    Show system information');
    console.log('    Example: yarn start info');
    console.log('');
    console.log('  calc <a> <b> --op <operation>');
    console.log('    Calculate a math operation');
    console.log('    Operations: add, sub, mul, div (or +, -, *, /)');
    console.log('    Example: yarn start calc 10 5 --op add');
    console.log('');
    console.log('  calc-schema <a> <b> --op <operation>');
    console.log('    Calculate a math operation (with schema validation)');
    console.log('    Operations: add, sub, mul, div (or +, -, *, /)');
    console.log('    Example: yarn start calc-schema 10 5 --op add');
    console.log('');
    console.log('  echo <text> [--uppercase]');
    console.log('    Echo text back');
    console.log('    Example: yarn start echo "Hello World" --uppercase');
    console.log('');
    console.log('  help');
    console.log('    Show this help message');
    console.log('');

    return {
      status: 0,
      value: { message: 'Help displayed' },
      meta: {},
    };
  },
});
