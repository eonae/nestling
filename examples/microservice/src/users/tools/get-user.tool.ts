import { GetUser as GetUserOperation } from '../../api/operations.js';
import { observability } from '../../observability.js';
import { GetUserHandler } from '../endpoints/index.js';

import { mcpTool } from '@nestlingjs/mcp';

/**
 * Инструмент агента поверх операции `users.get`.
 *
 * Схемы, отказы и описание берутся с операции — второго описания для
 * агента не пишется. Имя выводится из имени операции заменой точек на
 * подчёркивания: `users.get` даёт `users_get`.
 *
 * Класс-хендлер тот же, что у HTTP-декларации: у операции две входящие
 * поверхности и одно исполнение.
 */
export const GetUserTool = mcpTool.implement(GetUserOperation, {
  annotations: { readOnlyHint: true },
  pipeline: observability,
  handler: GetUserHandler,
});
