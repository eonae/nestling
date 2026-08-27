/**
 * Контракты примера — единственное, что знают друг о друге фичи.
 *
 * Ни одна из них не экспортирует токен наружу: общение идёт контрактами,
 * поэтому решение «в одном процессе или в разных» принимается на сборке,
 * а не при написании кода.
 */

import { makeContract } from '@nestling/contracts';
import { defineFail } from '@nestling/pipeline';
import { z } from 'zod';

/** Квота исчерпана — задекларированный отказ, переживающий провод по коду */
export const QuotaExceeded = defineFail('QUOTA_EXCEEDED', {
  status: 'CONFLICT',
  message: (details: { tenantId: string }) =>
    `Quota exceeded for tenant '${details.tenantId}'`,
  details: z.object({ tenantId: z.string() }),
});

/**
 * Команда приёма заказа — вход процесса-потребителя.
 *
 * Обычная команда, а не HTTP-ручка: пример про шину, и внешний драйвер у
 * него тоже шина. С HTTP-ручкой он выглядел бы так же — меняется
 * транспорт входа, не код фичи.
 */
export const PlaceOrder = makeContract({
  name: 'orders.place',
  kind: 'command',
  input: z.object({ orderId: z.string(), amount: z.number() }),
});

/**
 * Запрос к владельцу квот.
 *
 * Именно `request`: у него ровно один владелец, и до появления remote-шины
 * вызов без co-located реализации валил сборку. Теперь «владельца не
 * выбрали здесь» означает «он в другом процессе».
 */
export const ClaimQuota = makeContract({
  name: 'quotas.claim',
  kind: 'request',
  input: z.object({ tenantId: z.string(), amount: z.number() }),
  output: z.object({ granted: z.number() }),
  errors: [QuotaExceeded],
});

/**
 * Факт размещения заказа.
 *
 * `durable: true` — факт не должен потеряться, пока подписчик лежит.
 * Долговечность объявлена **контрактом**, потому что знать о ней обязаны
 * обе стороны: издатель ждёт подтверждения записи, подписчик читает
 * долговечно, а живут они в разных процессах.
 */
export const OrderPlaced = makeContract({
  name: 'orders.placed',
  kind: 'event',
  durable: true,
  input: z.object({ orderId: z.string(), tenantId: z.string() }),
});
