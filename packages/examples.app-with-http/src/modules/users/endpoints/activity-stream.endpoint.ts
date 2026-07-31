import { noValidationPipeline } from '../../../common/pipelines';
import { ActivityHub } from '../activity.hub';

import type { Output } from '@nestling/pipeline';
import { compose, events, makePipeline, Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const ActivityEventSchema = z.object({
  id: z.string(),
  kind: z.enum(['created', 'updated', 'deleted']),
  userId: z.string(),
  at: z.string(),
});

type ActivityEventOut = z.infer<typeof ActivityEventSchema>;

/**
 * Наблюдатель подписки.
 *
 * Для потоковой формы `.finally` вызывается **после** того, как поток
 * дотёк или оборвался, — поэтому `outcome` честен, а `ctx.summary` уже
 * досчитан. Отвал клиента для `events` — нормальное завершение
 * (`disconnected`), а не ошибка.
 */
const subscriptionObserver = makePipeline<{ requestId: string }>().finally(
  (outcome, _res, ctx) => {
    // eslint-disable-next-line no-console
    console.log(
      `[activity] подписка завершена: ${outcome}, ` +
        `отдано событий: ${ctx.summary.itemsOut}`,
    );
  },
);

/**
 * SSE-лента активности поверх `Topic`.
 *
 * Демонстрирует:
 * - форму `events(T)`: открытая подписка, framing — SSE, нормальное
 *   завершение — дисконнект;
 * - SSE-специфику в HTTP-словаре (`sse`), а не в транспорт-нейтральной
 *   форме;
 * - `meta.signal` как единственный механизм отмены: подписка снимается
 *   сама, когда клиент уходит;
 * - `Last-Event-ID`: заголовок реконнекта приезжает в **типизированном**
 *   стартовом контексте, и решение «откуда продолжить» принимает хендлер.
 */
export const ActivityStream = httpEndpoint({
  method: 'GET',
  path: '/api/users/activity',
  output: events(ActivityEventSchema),
  sse: {
    id: (event) => event.id,
    event: (event) => event.kind,
  },
  pipeline: compose(noValidationPipeline, subscriptionObserver),
  deps: [ActivityHub],
  handle:
    (hub: ActivityHub) =>
    async (
      _payload: unknown,
      meta: { signal: AbortSignal; lastEventId?: string },
    ): Output<AsyncIterable<ActivityEventOut>> => {
      if (meta.lastEventId) {
        // Реальная лента отдала бы историю с этого места; пример только
        // показывает, что заголовок доехал типизированным
        // eslint-disable-next-line no-console
        console.log(`[activity] реконнект с id=${meta.lastEventId}`);
      }

      return new Ok(hub.subscribe(meta.signal));
    },
});
