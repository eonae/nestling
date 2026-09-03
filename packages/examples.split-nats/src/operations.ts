/**
 * Операции, через которые общаются фичи `users` и `quotas`.
 *
 * Обе фичи импортируют только этот файл: ни одна не знает токенов другой,
 * поэтому решение «один процесс или два» принимает корень, а не код фич.
 */

import {
  makeFail,
  makeCommand,
  makeEvent,
  makeRequest,
} from '@nestling/operations';
import { z } from 'zod';

/** Отказ владельца квот: лимит арендатора исчерпан */
export const QuotaExceeded = makeFail('too_many_requests:quota_exceeded', { details: z.object({ limit: z.number() }),
  message: (details) => `Quota of ${details.limit} users is exhausted`,
});

export const RegisterUserInput = z.object({ email: z.email() });
export type RegisterUserInput = z.infer<typeof RegisterUserInput>;

/**
 * Команда регистрации: вход процесса `users`.
 *
 * Внешний клиент кладёт её на шину. Команда, а не HTTP-endpoint, потому что
 * пример показывает шину; с HTTP-входом код фичи был бы тем же.
 */
export const RegisterUser = makeCommand({
  name: 'users.register',
  input: RegisterUserInput,
});

export const ClaimQuotaInput = z.object({ email: z.string() });
export const ClaimQuotaOutput = z.object({ remaining: z.number() });
export type ClaimQuotaInput = z.infer<typeof ClaimQuotaInput>;
export type ClaimQuotaOutput = z.infer<typeof ClaimQuotaOutput>;

/**
 * Запрос к владельцу квот.
 *
 * У запроса ровно один владелец, и вызывающий ждёт ответа. Если владелец
 * не выбран в этой сборке, вызов уходит через брокер в другой процесс.
 */
export const ClaimQuota = makeRequest({
  name: 'quotas.claim',
  input: ClaimQuotaInput,
  output: ClaimQuotaOutput,
  errors: [QuotaExceeded],
});

export const UserRegisteredInput = z.object({
  id: z.string(),
  email: z.string(),
});
export type UserRegisteredInput = z.infer<typeof UserRegisteredInput>;

/**
 * Факт регистрации пользователя.
 *
 * `durable: true` объявляет доставку, которая переживает перезапуск
 * подписчика: брокер заводит под событием поток JetStream, издатель ждёт
 * подтверждения записи, подписчик читает из потока.
 */
export const UserRegistered = makeEvent({
  name: 'users.registered',
  durable: true,
  input: UserRegisteredInput,
});
