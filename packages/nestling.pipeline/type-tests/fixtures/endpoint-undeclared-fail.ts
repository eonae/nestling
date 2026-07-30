/**
 * Фикстура: хендлер возвращает отказ, не объявленный в `errors:`.
 *
 * Снапшот фиксирует читаемость диагностики контракта отказов: сообщение
 * обязано доводить до строки «"CARD_DECLINED" is not assignable to
 * "ORDER_LIMIT_REACHED"», а не тонуть в раскрытии дженериков.
 */

import { defineFail, makeEndpoint } from '@nestling/pipeline';
import { z } from 'zod';

const OrderOutput = z.object({ id: z.string() });

const OrderLimitReached = defineFail('ORDER_LIMIT_REACHED', {
  status: 'CONFLICT',
  message: 'Order limit reached',
});

const CardDeclined = defineFail('CARD_DECLINED', {
  status: 'PAYMENT_REQUIRED',
  message: 'Card declined',
});

export const CreateOrder = makeEndpoint({
  transport: 'http',
  pattern: 'POST /orders',
  output: OrderOutput,
  errors: [OrderLimitReached],
  handle: async () => CardDeclined(),
});
