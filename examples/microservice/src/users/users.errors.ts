import { makeFail } from '@nestlingjs/operations';
import { z } from 'zod';

/**
 * Отказы сервиса пользователей.
 *
 * Отказ — значение с машинным кодом. Первый сегмент кода — категория,
 * её транспорт переводит в свой статус (`not_found` → 404). Endpoint
 * перечисляет свои отказы в `errors:`, и тот же список получают клиент и
 * документ OpenAPI.
 */

export const UserNotFound = makeFail('not_found:user', {
  details: z.object({ id: z.string() }),
  message: (d) => `User ${d.id} not found`,
});

/** Категория `conflict`: занятый email — конфликт с данными, а не ошибка формата */
export const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} is already taken`,
});

export const AvatarRequired = makeFail('bad_request:avatar_required', {
  message: 'Form field "avatar" is required',
});

/** Подпись тела webhook'а не сошлась с ожидаемой */
export const InvalidSignature = makeFail('unauthorized:invalid_signature', {
  message: 'Webhook signature does not match the request body',
});

/** Изменение без единого поля: запрос не на что применить */
export const NothingToUpdate = makeFail('bad_request:nothing_to_update', {
  message: 'At least one field must be provided',
});
