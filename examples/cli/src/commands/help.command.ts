import { baseUrl } from '../api.js';

import { stream } from '@nestlingjs/operations';
import { cliEndpoint } from '@nestlingjs/transport.cli';
import { z } from 'zod';

/** Строки справки; последняя точка вывода — транспорт, а не команда */
const lines = (): readonly string[] => [
  `Service: ${baseUrl} (API_URL, API_TOKEN)`,
  '',
  '  help',
  '    Show this help message',
  '',
  '  create-user [--name <name>] [--email <email>] [--check]',
  '    Create a user; missing options are asked in the terminal',
  '',
  '  list-users [--limit <n>]',
  '    Print the users of the service',
  '',
  '  export-users',
  '    Stream the service export line by line',
  '',
  '  import-users',
  '    Read NDJSON from stdin and create the users in it',
  '',
];

/**
 * `help`: отдаёт список команд.
 *
 * Форма `stream(z.string())` на выходе: справка — результат команды, и на
 * `stdout` её кладёт транспорт. Логгер сюда не годится — его записи
 * уходят в `stderr` и несут время и уровень.
 */
export const Help = cliEndpoint('help', {
  output: stream(z.string()),
  handler: async function* () {
    for (const line of lines()) {
      yield `${line}\n`;
    }
  },
});
