/**
 * Типовые тесты `errorsOf`: список отказов чужой операции типизирует
 * `errors:` вызывающей декларации так же, как прямое перечисление.
 *
 * Файл не гоняется vitest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативный случай закрыт `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { makeFail } from './make-fail.js';
import type { OperationFailsOf } from './operation.js';
import { errorsOf, makeEvent, makeRequest } from './operation.js';

import { z } from 'zod';

const QuotaExceeded = makeFail('too_many_requests:quota_exceeded', {
  message: 'Quota exceeded',
});

const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} is already taken`,
});

const ClaimQuota = makeRequest({
  name: 'errors-of-type-test.quotas.claim',
  errors: [QuotaExceeded],
});

const CreateUser = makeRequest({
  name: 'errors-of-type-test.users.create',
  errors: [...errorsOf(ClaimQuota), EmailTaken],
});

/** Отказ соседней операции входит в union хендлера, как если бы был перечислен напрямую */
function handlesInheritedFail(): OperationFailsOf<typeof CreateUser> {
  return QuotaExceeded();
}

/** Собственный отказ операции остаётся в том же union'е */
function handlesOwnFail(): OperationFailsOf<typeof CreateUser> {
  return EmailTaken({ email: 'a@b.co' });
}

const UserNotified = makeEvent({
  name: 'errors-of-type-test.users.notified',
});

// @ts-expect-error: `makeEvent` не объявляет `errors:`, читать нечего
errorsOf(UserNotified);
