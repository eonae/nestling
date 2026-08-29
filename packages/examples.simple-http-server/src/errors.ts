import { defineFail } from '@nestling/pipeline';
import { z } from 'zod';

/**
 * Доменные отказы примера.
 *
 * Отказ — значение с машинным кодом: `errors:` декларации превращает его
 * в часть контракта endpoint'а, а всё незадекларированное граница
 * пайплайна отдаёт клиенту как `UNKNOWN`/500.
 */
export const EmailTaken = defineFail('EMAIL_TAKEN', {
  status: 'CONFLICT',
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} already taken`,
});
