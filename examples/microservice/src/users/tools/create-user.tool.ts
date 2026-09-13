import { CreateUser as CreateUserOperation } from '../../api/operations.js';
import { transactional } from '../../persistence.js';
import { CreateUserHandler } from '../endpoints/index.js';

import { mcpTool } from '@nestlingjs/mcp';

/**
 * Инструмент агента поверх операции `users.create`.
 *
 * Слой тот же, что у HTTP-декларации: `transactional` открывает
 * транзакцию и приносит с собой проверку Bearer-токена. Заголовки
 * запроса агента доходят до шага обычным путём, поэтому инструмент,
 * меняющий данные, проверяет вызывающего так же, как их проверяет HTTP.
 *
 * Пайплайн объявлен у декларации, а не у транспорта: слой выбирает
 * инструмент, и политика в `app.ts` проверяет, что он есть у каждого.
 */
export const CreateUserTool = mcpTool.implement(CreateUserOperation, {
  annotations: { idempotentHint: false },
  pipeline: transactional,
  handler: CreateUserHandler,
});
