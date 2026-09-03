import { defineFail } from '@nestling/operations';
import { z } from 'zod';

/**
 * Отказ «email занят».
 *
 * `status` не зависит от транспорта: HTTP переводит `CONFLICT` в 409.
 * Отказ попадает в ответ endpoint'а только через его список `errors:`.
 */
export const EmailTaken = defineFail('EMAIL_TAKEN', {
  status: 'CONFLICT',
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} already taken`,
});
