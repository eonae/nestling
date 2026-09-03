/**
 * Операции между фичами.
 *
 * Файл лежит вне фич: операция не принадлежит ни вызывающему, ни
 * реализующему. Фича `quotas` реализует операции через `implement`, фича
 * `users` вызывает их через `.caller` и `.emitter`. Где живёт реализация,
 * решает сборка.
 */

import {
  makeFail,
  makeCommand,
  makeEvent,
  makeRequest,
} from '@nestling/operations';
import { z } from 'zod';

/** Отказ «квота исчерпана». По сети приходит кодом и восстанавливается в `Fail` */
export const QuotaExceeded = makeFail('too_many_requests:quota_exceeded', { details: z.object({ limit: z.number() }),
  message: (d) => `User quota of ${d.limit} is exhausted`,
});

export const ClaimQuotaInput = z.object({ email: z.string() });

export type ClaimQuotaInput = z.infer<typeof ClaimQuotaInput>;

/**
 * Запрос «займи место под ещё одного пользователя».
 *
 * Вид `request`: без ответа продолжить нельзя, у операции ровно один
 * владелец.
 */
export const ClaimQuota = makeRequest({
  name: 'quotas.claim',
  input: ClaimQuotaInput,
  output: z.object({ remaining: z.number() }),
  errors: [QuotaExceeded],
});

export const UserRegisteredInput = z.object({
  id: z.string(),
  email: z.string(),
});

export type UserRegisteredInput = z.infer<typeof UserRegisteredInput>;

/**
 * Событие «пользователь создан».
 *
 * Вид `event`: факт уже случился, подписчиков любое число. Ответа нет,
 * `emit` завершается по факту доставки.
 */
export const UserRegistered = makeEvent({
  name: 'users.registered',
  input: UserRegisteredInput,
});

export const SignupRecordedInput = z.object({
  userId: z.string(),
  email: z.string(),
});

export type SignupRecordedInput = z.infer<typeof SignupRecordedInput>;

/**
 * Команда «запиши регистрацию в журнал квот».
 *
 * Вид `command`: владелец ровно один, и повторную доставку нужно отличать
 * от новой регистрации. Для этого у `meta` команды есть `idempotencyKey`;
 * у события и запроса его нет. Ядро ключ не проверяет, а только доставляет
 * до обработчика.
 */
export const SignupRecorded = makeCommand({
  name: 'quotas.record-signup',
  input: SignupRecordedInput,
});
