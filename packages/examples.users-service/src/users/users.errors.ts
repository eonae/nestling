import { makeFail } from '@nestling/operations';
import { z } from 'zod';

/**
 * Отказы сервиса пользователей.
 *
 * Отказ — значение с машинным кодом. Endpoint перечисляет свои отказы в
 * `errors:`, и тот же список получают клиент и документ OpenAPI.
 */

export const UserNotFound = makeFail('not_found:user_not_found', { details: z.object({ id: z.string() }),
  message: (d) => `User ${d.id} not found`,
});

/** Статус `conflict`: занятый email — конфликт с данными, а не ошибка формата */
export const EmailTaken = makeFail('conflict:email_taken', { details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} is already taken`,
});

export const AvatarRequired = makeFail('bad_request:avatar_required', { message: 'Form field "avatar" is required',
});
