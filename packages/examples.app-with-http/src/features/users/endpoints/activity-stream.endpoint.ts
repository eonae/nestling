import { observability } from '../../../plugins/logging';
import { ActivityHub } from '../activity.hub';

import { events, Ok } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { compose } from '@nestling/pipeline';
import type { TrackedSubscription } from '@nestling/subscriptions';
import { tracked } from '@nestling/subscriptions';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const ActivityEvent = z.object({
  id: z.string(),
  kind: z.enum(['created', 'updated', 'deleted']),
  userId: z.string(),
  at: z.string(),
});

type ActivityEvent = z.infer<typeof ActivityEvent>;

/**
 * Лента активности по SSE.
 *
 * Форма `events(T)`: подписка открыта, пока клиент подключён, и отвал
 * клиента — нормальное завершение. `sse:` задаёт поля кадра. Слой
 * `tracked` регистрирует подписку в реестре, и её видно в
 * `GET /ops/subscriptions`.
 *
 * Хендлер слушает `meta.subscription.signal`: он объединяет сигнал запроса
 * с административной отменой из реестра. Заголовок `Last-Event-ID`
 * приходит типизированным полем `meta.lastEventId`.
 */
export const ActivityStream = httpEndpoint({
  method: 'GET',
  path: '/users/activity',
  output: events(ActivityEvent),
  sse: {
    id: (event) => event.id,
    event: (event) => event.kind,
  },
  doc: { summary: 'Лента активности (SSE)', tags: ['users'] },
  pipeline: compose(observability, tracked),
  deps: [ActivityHub],
  handle:
    (hub: ActivityHub) =>
    async (
      _payload: unknown,
      meta: { subscription: TrackedSubscription; lastEventId?: string },
    ): Output<AsyncIterable<ActivityEvent>> => {
      // Настоящая лента отдала бы историю с этого места
      const since = meta.lastEventId ?? '0';

      return new Ok(hub.subscribe(meta.subscription.signal, since));
    },
});
