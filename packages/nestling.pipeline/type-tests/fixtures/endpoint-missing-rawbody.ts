/**
 * Фикстура: слот `pipeline` транспортной декларации.
 *
 * Слой объявлен как требующий `{ rawBody: Uint8Array }`, а пометки
 * `rawBody: true` в словаре нет — стартовый контекст этих байтов не даёт.
 * Диагностика обязана быть той же формы, что у `compose`, плюс `hint`
 * с конкретным действием.
 */

import { makePipeline, Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

export const StripeHook = httpEndpoint({
  method: 'POST',
  path: '/hooks/stripe',
  pipeline: makePipeline<{ rawBody: Uint8Array }>(),
  handler: async () => new Ok({ received: true }),
});
