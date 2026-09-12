import { CreateUser as CreateUserOperation } from '../../../api/operations.js';
import { authed } from '../../../plugins/auth/index.js';
import { CreateUserHandler } from '../endpoints/index.js';

import { mcpTool } from '@nestlingjs/mcp';

/**
 * Инструмент агента поверх операции `users.create`.
 *
 * Слой тот же, что у HTTP-декларации: `authed` читает Bearer-токен из
 * `ctx.raw.attributes`, а заголовки запроса агента доходят туда обычным
 * путём. Инструмент, меняющий данные, проверяет вызывающего так же, как
 * их проверяет HTTP.
 *
 * Пайплайн объявлен у декларации, а не у транспорта: слой выбирает
 * инструмент, и политика в `app.ts` проверяет, что он есть у каждого.
 */
export const CreateUserTool = mcpTool.implement(CreateUserOperation, {
  annotations: { idempotentHint: false },
  pipeline: authed,
  handler: CreateUserHandler,
});
