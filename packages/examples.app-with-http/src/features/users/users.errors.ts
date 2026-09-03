import { makeFail } from '@nestling/operations';
import { z } from 'zod';

/**
 * Отказы фичи пользователей.
 *
 * Отказ — значение с машинным кодом. Endpoint перечисляет свои отказы в
 * `errors:`, и тот же список получают клиент и документ OpenAPI.
 */

export const UserNotFound = makeFail('not_found:user', {
  details: z.object({ id: z.string() }),
  message: (d) => `User ${d.id} not found`,
});

/** Статус `conflict`: занятый email — конфликт с данными, а не ошибка формата */
export const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} is already taken`,
});

export const NothingToUpdate = makeFail('bad_request:nothing_to_update', {
  message: 'No fields to update',
});

export const AvatarRequired = makeFail('bad_request:avatar_required', {
  message: 'Form field "avatar" is required',
});

export const InvalidSignature = makeFail('unauthorized:invalid_signature', {
  message: 'Webhook signature does not match the body',
});
