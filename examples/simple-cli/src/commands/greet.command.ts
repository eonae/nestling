import { cliEndpoint } from '@nestling/transport.cli';
import { z } from 'zod';

/**
 * Вход команды с формой значения: позиционные аргументы попадают в `args`,
 * опции `--key value` и флаги `--flag` — в одноимённые поля.
 */
const GreetInput = z.object({
  args: z.array(z.string()).min(1, 'name is required'),
  shout: z.boolean().optional(),
});

const GreetOutput = z.object({
  greeting: z.string(),
});

/**
 * `greet <name> [--shout]`: печатает приветствие.
 *
 * Результат команды транспорт печатает в stdout как JSON.
 */
export const Greet = cliEndpoint({
  command: 'greet',
  input: GreetInput,
  output: GreetOutput,
  handler: async ({ args, shout }) => {
    const text = `Hello, ${args[0]}!`;

    return { greeting: shout ? text.toUpperCase() : text };
  },
});
