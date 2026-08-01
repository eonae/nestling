import { noValidationPipeline } from '../../../common/pipelines';
import { ActivityHub } from '../activity.hub';

import type { Output } from '@nestling/pipeline';
import { compose, events, makePipeline, Ok } from '@nestling/pipeline';
import type { TrackedSubscription } from '@nestling/subscriptions';
import { tracked } from '@nestling/subscriptions';
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
 * - слой `tracked`: подписка попадает в реестр, и её видно в
 *   `GET /api/ops/subscriptions`;
 * - `meta.subscription.signal` как **единственный** источник отмены для
 *   хендлера;
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
  pipeline: compose(noValidationPipeline, tracked, subscriptionObserver),
  deps: [ActivityHub],
  handle:
    (hub: ActivityHub) =>
    async (
      _payload: unknown,
      meta: {
        subscription: TrackedSubscription;
        lastEventId?: string;
      },
    ): Output<AsyncIterable<ActivityEventOut>> => {
      if (meta.lastEventId) {
        // Реальная лента отдала бы историю с этого места; пример только
        // показывает, что заголовок доехал типизированным
        // eslint-disable-next-line no-console
        console.log(`[activity] реконнект с id=${meta.lastEventId}`);
      }

      // Именно `meta.subscription.signal`, а не `meta.signal`: он
      // комбинирует сигнал запроса (дисконнект, shutdown) с
      // административным контроллером записи, поэтому одна подписка на него
      // закрывает и `DELETE /api/ops/subscriptions/:id`. Ключ `signal` в
      // `meta` зарезервирован пайплайном и подмене не подлежит — админский
      // канал обязан быть вторым полем
      return new Ok(hub.subscribe(meta.subscription.signal));
    },
});
