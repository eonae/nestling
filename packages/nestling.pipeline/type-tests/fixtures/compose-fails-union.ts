/**
 * Фикстура: хендлер возвращает отказ вне множества, собранного двумя
 * слоями.
 *
 * `compose` объединяет отказы слоёв, и декларация складывает их со своим
 * `errors:`. Снапшот показывает это множество целиком: по нему видно, что
 * отказы обоих слоёв попали в тип хендлера.
 */

import { makeToken } from '@nestling/container';
import {
  compose,
  makeEndpoint,
  makeFail,
  makePipeline,
} from '@nestling/pipeline';
import { z } from 'zod';

const HttpTransport$ = makeToken('transport:http');

const OrderOutput = z.object({ id: z.string() });

const Unauthorized = makeFail('unauthorized', { message: 'No token' });

const Forbidden = makeFail('forbidden', { message: 'Not yours' });

const CardDeclined = makeFail('payment_required:card_declined', {
  message: 'Card declined',
});

const authed = compose(
  makePipeline().pre(() => Unauthorized(), { errors: [Unauthorized] }),
  makePipeline().pre(() => Forbidden(), { errors: [Forbidden] }),
);

export const CreateOrder = makeEndpoint({
  transport: HttpTransport$,
  pattern: 'POST /orders',
  output: OrderOutput,
  pipeline: authed,
  handler: async () => CardDeclined(),
});
