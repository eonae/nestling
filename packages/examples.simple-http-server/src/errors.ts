import { makeFail } from '@nestling/operations';
import { z } from 'zod';

/**
 * Отказ «email занят».
 *
 * `status` не зависит от транспорта: HTTP переводит `conflict` в 409.
 * Отказ попадает в ответ endpoint'а только через его список `errors:`.
 */
export const EmailTaken = makeFail('conflict:email_taken', { details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} already taken`,
});
