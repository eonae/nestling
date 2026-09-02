/**
 * Фикстура: хендлер возвращает отказ, не объявленный в `errors:`.
 *
 * Снапшот фиксирует читаемость диагностики операции отказов: сообщение
 * обязано доводить до строки «"CARD_DECLINED" is not assignable to
 * "ORDER_LIMIT_REACHED"», а не тонуть в раскрытии дженериков.
 */

import { makeToken } from '@nestling/container';
import { defineFail, makeEndpoint } from '@nestling/pipeline';
import { z } from 'zod';

const HttpTransport$ = makeToken('transport:http');

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
  transport: HttpTransport$,
  pattern: 'POST /orders',
  output: OrderOutput,
  errors: [OrderLimitReached],
  handle: async () => CardDeclined(),
});
