import { z } from 'zod';

/** Пользователь в ответах API. Одна схема на все endpoint'ы. */
export const User = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.email(),
  avatarUrl: z.string().optional(),
});

export type User = z.infer<typeof User>;

/** Данные для создания пользователя: идентификатор выдаёт хранилище */
export const NewUser = User.pick({ name: true, email: true });

export type NewUser = z.infer<typeof NewUser>;
