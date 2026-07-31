/**
 * Контракты между фичами — общее значение, а не общий сервис.
 *
 * Файл лежит вне обеих фич намеренно: контракт направление-нейтрален.
 * Фича `quotas` его **реализует** (`implement` в своих `endpoints:`), фича
 * `users` — **зовёт** (`deps: [ClaimQuota.port]`). Ни та ни другая не
 * знают, где живёт соседка: биндинг выбирается на сборке, а call-site
 * одинаков для co-located и split.
 */

import { defineFail, makeContract } from '@nestling/contracts';
import { z } from 'zod';

/**
 * Квота исчерпана — обычный доменный отказ, объявленный в контракте.
 *
 * По проводу он приехал бы кодом, и вызыватель ре-гидрирует его обратно в
 * настоящий `Fail`: `QuotaExceeded.is(result)` истинно на обоих путях.
 */
export const QuotaExceeded = defineFail('QUOTA_EXCEEDED', {
  status: 'TOO_MANY_REQUESTS',
  details: z.object({ limit: z.number() }),
  message: (d) => `User quota of ${d.limit} is exhausted`,
});

/**
 * Запрос: «займи место под ещё одного пользователя».
 *
 * `request` — потому что ответ нужен здесь и сейчас: без него создавать
 * пользователя нельзя.
 */
export const ClaimQuota = makeContract({
  name: 'quotas.claim',
  kind: 'request',
  input: z.object({ email: z.string() }),
  output: z.object({ remaining: z.number() }),
  errors: [QuotaExceeded],
});

/**
 * Событие: «пользователь заведён».
 *
 * `event` — потому что факт уже случился и подписчиков может быть сколько
 * угодно (в этой сборке — один, `quotas`). Ответа у события нет: `emit`
 * возвращает `Promise<void>` по факту доставки.
 */
export const UserRegistered = makeContract({
  name: 'users.registered',
  kind: 'event',
  input: z.object({ id: z.string(), email: z.string() }),
});

/**
 * Команда: «зафиксируй регистрацию в журнале квот».
 *
 * `command`, а не `event`: владелец ровно один, и повторная доставка
 * (ретрай брокера, перезапуск процесса) обязана быть отличима от новой
 * регистрации. Отличает её `idempotencyKey` — поле, которое есть в словаре
 * `meta` **только** у этого вида: на `event` и `request` обращение к нему
 * не компилируется.
 *
 * Дедупликации ядро не делает: оно гарантирует, что ключ доедет и будет
 * доступен обработчику, — а что с ним делать, решает владелец команды.
 */
export const SignupRecorded = makeContract({
  name: 'quotas.record-signup',
  kind: 'command',
  input: z.object({ userId: z.string(), email: z.string() }),
});
