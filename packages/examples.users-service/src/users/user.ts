import { z } from 'zod';

/** Пользователь в ответах API. Одна схема на все endpoint'ы. */
export const User = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.email(),
  avatarUrl: z.string().optional(),
});

export type User = z.infer<typeof User>;

/**
 * Данные для создания пользователя: идентификатор выдаёт хранилище.
 *
 * `dryRun` — проверить данные, не создавая запись. Поле приходит из
 * query-строки, остальные — из тела: место задаёт пометка `bind` в
 * операции.
 */
export const CreateUserInput = User.pick({ name: true, email: true }).extend({
  dryRun: z.coerce.boolean().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserInput>;
