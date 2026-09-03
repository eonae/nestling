/**
 * Фикстура: хендлер возвращает отказ, не объявленный в `errors:`.
 *
 * Снапшот фиксирует читаемость диагностики операции отказов: сообщение
 * обязано доводить до строки «"payment_required:card_declined" is not assignable to
 * "conflict:order_limit_reached"», а не тонуть в раскрытии дженериков.
 */

import { makeToken } from '@nestling/container';
import { makeFail, makeEndpoint } from '@nestling/pipeline';
import { z } from 'zod';

const HttpTransport$ = makeToken('transport:http');

const OrderOutput = z.object({ id: z.string() });

const OrderLimitReached = makeFail('conflict:order_limit_reached', { message: 'Order limit reached',
});

const CardDeclined = makeFail('payment_required:card_declined', { message: 'Card declined',
});

export const CreateOrder = makeEndpoint({
  transport: HttpTransport$,
  pattern: 'POST /orders',
  output: OrderOutput,
  errors: [OrderLimitReached],
  handler: async () => CardDeclined(),
});
