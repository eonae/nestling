/* eslint-disable no-console -- справка печатается человеку */

import { baseUrl } from '../api.js';

import { cliEndpoint } from '@nestlingjs/transport.cli';
import { z } from 'zod';

const HelpOutput = z.object({ message: z.string() });

/** `help`: печатает список команд */
export const Help = cliEndpoint('help', {
  output: HelpOutput,
  handler: async () => {
    console.log(`Service: ${baseUrl} (API_URL, API_TOKEN)`);
    console.log('');
    console.log('  help');
    console.log('    Show this help message');
    console.log('');
    console.log('  create-user [--name <name>] [--email <email>] [--check]');
    console.log('    Create a user; missing options are asked in the terminal');
    console.log('');
    console.log('  list-users [--limit <n>]');
    console.log('    Print the users of the service');
    console.log('');
    console.log('  export-users');
    console.log('    Stream the service export line by line');
    console.log('');
    console.log('  import-users');
    console.log('    Read NDJSON from stdin and create the users in it');
    console.log('');

    return { message: 'Help displayed' };
  },
});
