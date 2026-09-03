import { defineFail } from '@nestling/operations';
import { z } from 'zod';

/**
 * Отказы фичи пользователей.
 *
 * Отказ — значение с машинным кодом. Endpoint перечисляет свои отказы в
 * `errors:`, и тот же список получают клиент и документ OpenAPI.
 */

export const UserNotFound = defineFail('USER_NOT_FOUND', {
  status: 'NOT_FOUND',
  details: z.object({ id: z.string() }),
  message: (d) => `User ${d.id} not found`,
});

/** Статус `CONFLICT`: занятый email — конфликт с данными, а не ошибка формата */
export const EmailTaken = defineFail('EMAIL_TAKEN', {
  status: 'CONFLICT',
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} is already taken`,
});

export const NothingToUpdate = defineFail('NOTHING_TO_UPDATE', {
  status: 'BAD_REQUEST',
  message: 'No fields to update',
});

export const AvatarRequired = defineFail('AVATAR_REQUIRED', {
  status: 'BAD_REQUEST',
  message: 'Form field "avatar" is required',
});

export const InvalidSignature = defineFail('INVALID_SIGNATURE', {
  status: 'UNAUTHORIZED',
  message: 'Webhook signature does not match the body',
});
