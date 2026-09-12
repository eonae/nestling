import { cliEndpoint } from '@nestlingjs/transport.cli';
import { z } from 'zod';

/**
 * Вход команды, часть которого собирается вопросами.
 *
 * Вопрос выводится из схемы, а не объявляется рядом с ней: `enum` даёт
 * выбор из списка, `boolean` — подтверждение, `describe` — подсказку.
 * Умолчание объявлено аннотацией `meta`, а не `default`: поле с
 * `.default(…)` необязательно, схема подставляет значение сама и
 * спрашивать нечего.
 */
const DeployInput = z.object({
  env: z.enum(['dev', 'prod']).describe('Target environment'),
  force: z.boolean().describe('Skip the safety checks'),
  host: z.string().describe('Deployment host').meta({ default: 'localhost' }),
});

const DeployOutput = z.object({
  env: z.string(),
  host: z.string(),
  forced: z.boolean(),
});

/**
 * `deploy [--env dev|prod] [--force] [--host …]`: недостающее спрашивает.
 *
 * Политика `missing: 'prompt'` работает, пока ввод — терминал: в конвейере
 * и под `CI` команда доходит до валидации и отвечает отказом, как команда
 * без политики.
 */
export const Deploy = cliEndpoint({
  command: 'deploy',
  input: DeployInput,
  output: DeployOutput,
  missing: 'prompt',
  handler: async ({ env, force, host }) => ({ env, host, forced: force }),
});
