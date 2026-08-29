/**
 * Контракты между фичами.
 *
 * Файл лежит вне обеих фич: контракт не принадлежит ни вызывающему, ни
 * реализующему. Фича `quotas` реализует контракты (`implement` в её
 * `endpoints:`), фича `users` вызывает их (`deps: [ClaimQuota.port]`).
 * Где живёт реализация, решает сборка; код вызова одинаков для одного
 * процесса и для split-развёртывания.
 */

import { defineFail, makeContract } from '@nestling/contracts';
import { z } from 'zod';

/**
 * Отказ «квота исчерпана», объявленный в контракте.
 *
 * При вызове через брокер отказ приходит как данные с кодом; порт
 * восстанавливает из них настоящий `Fail`, поэтому `QuotaExceeded.is(…)`
 * работает одинаково для локального и удалённого вызова.
 */
export const QuotaExceeded = defineFail('QUOTA_EXCEEDED', {
  status: 'TOO_MANY_REQUESTS',
  details: z.object({ limit: z.number() }),
  message: (d) => `User quota of ${d.limit} is exhausted`,
});

/**
 * Запрос «займи место под ещё одного пользователя».
 *
 * Вид `request`, потому что без ответа продолжить нельзя: пользователя
 * создают только после подтверждения квоты.
 */
export const ClaimQuota = makeContract({
  name: 'quotas.claim',
  kind: 'request',
  input: z.object({ email: z.string() }),
  output: z.object({ remaining: z.number() }),
  errors: [QuotaExceeded],
});

/**
 * Событие «пользователь создан».
 *
 * Вид `event`: факт уже случился, подписчиков может быть сколько угодно
 * (в этом примере один — `quotas`). Ответа у события нет; `emit`
 * возвращает `Promise<void>`, который завершается по факту доставки.
 */
export const UserRegistered = makeContract({
  name: 'users.registered',
  kind: 'event',
  input: z.object({ id: z.string(), email: z.string() }),
});

/**
 * Команда «зафиксируй регистрацию в журнале квот».
 *
 * Вид `command`, а не `event`: владелец ровно один, и повторную доставку
 * (ретрай брокера, перезапуск процесса) нужно отличать от новой
 * регистрации. Для этого у `meta` команды есть поле `idempotencyKey`; у
 * `event` и `request` его нет, и обращение к нему не компилируется.
 *
 * Ядро не дедуплицирует команды: оно гарантирует, что ключ дойдёт до
 * обработчика. Что с ним делать, решает владелец команды.
 */
export const SignupRecorded = makeContract({
  name: 'quotas.record-signup',
  kind: 'command',
  input: z.object({ userId: z.string(), email: z.string() }),
});
