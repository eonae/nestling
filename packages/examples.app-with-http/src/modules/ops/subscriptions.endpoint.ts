import { basePipeline, noValidationPipeline } from '../../common/pipelines';

import type { Output } from '@nestling/pipeline';
import { compose, defineFail, events, Ok } from '@nestling/pipeline';
import type {
  SubscriptionInfo,
  TrackedSubscription,
} from '@nestling/subscriptions';
import { SubscriptionRegistry, tracked } from '@nestling/subscriptions';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

/** Снимок подписки на проводе — ровно то, что отдаёт `registry.list()` */
const Subscription = z.object({
  id: z.string(),
  transport: z.string(),
  pattern: z.string(),
  kind: z.enum(['value', 'stream', 'events']),
  identity: z.string().optional(),
  labels: z.record(z.string(), z.string()),
  startedAt: z.number(),
  itemsOut: z.number(),
});

/** Событие ленты реестра на проводе */
const SubscriptionChange = z.object({
  type: z.enum(['opened', 'closed']),
  reason: z.string().optional(),
  subscription: Subscription,
});

type SubscriptionChange = z.infer<typeof SubscriptionChange>;

/**
 * Подписки, которой просят завершиться, в этом процессе нет.
 *
 * Реестр node-local: `abort` действует только на свой процесс, поэтому
 * «не нашли» здесь честно означает «не нашли **здесь**», а не «такой
 * подписки не существует».
 */
export const SubscriptionNotFound = defineFail('SUBSCRIPTION_NOT_FOUND', {
  status: 'NOT_FOUND',
  details: z.object({ id: z.string() }),
  message: (d) => `Subscription ${d.id} is not active on this node`,
});

/** Снимок реестра в форме провода */
const toWire = (info: SubscriptionInfo): z.infer<typeof Subscription> => ({
  id: info.id,
  transport: info.transport,
  pattern: info.pattern,
  kind: info.kind,
  identity: info.identity,
  labels: { ...info.labels },
  startedAt: info.startedAt,
  itemsOut: info.itemsOut,
});

/**
 * Список активных подписок узла.
 *
 * Реестр инжектится обычным токеном: satellite не заводит ни особого
 * способа доступа, ни своей оси регистрации.
 */
export const ListSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/api/ops/subscriptions',
  output: z.array(Subscription),
  doc: {
    summary: 'Активные подписки этого узла',
    description:
      'Реестр node-local: список отражает подписки процесса, который ' +
      'ответил на запрос. Кластерная картина собирается из фактов ' +
      'subscriptions.opened/closed.',
    tags: ['ops'],
  },
  pipeline: basePipeline,
  deps: [SubscriptionRegistry],
  handle:
    (registry: SubscriptionRegistry) =>
    async (): Output<z.infer<typeof Subscription>[]> =>
      new Ok(registry.list().map((info) => toWire(info))),
});

/**
 * Административное завершение подписки.
 *
 * `abort` только взводит сигнал: запись снимет `.finally` пайплайна, когда
 * поток действительно закончится. Реестр отражает факт, а не опережает его.
 */
export const KillSubscription = httpEndpoint({
  method: 'DELETE',
  path: '/api/ops/subscriptions/:id',
  input: z.object({ id: z.string() }),
  errors: [SubscriptionNotFound],
  doc: {
    summary: 'Завершить подписку',
    tags: ['ops'],
    status: 'NO_CONTENT',
  },
  pipeline: basePipeline,
  deps: [SubscriptionRegistry],
  handle:
    (registry: SubscriptionRegistry) =>
    async (payload: {
      id: string;
    }): Output<null, ReturnType<typeof SubscriptionNotFound>> => {
      const killed = registry.abort(payload.id, 'administrative kill');

      if (!killed) {
        return SubscriptionNotFound({ id: payload.id });
      }

      return Ok.noContent();
    },
});

/**
 * Живой просмотр реестра — рекурсивный случай.
 *
 * Ручка сама композирована от `tracked`, поэтому попадает в тот реестр,
 * который показывает: в собственной ленте она видит чужие события, но не
 * своё `opened` — оно опубликовано до вызова хендлера, то есть до того, как
 * хендлер подписался.
 */
export const WatchSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/api/ops/subscriptions/live',
  output: events(SubscriptionChange),
  sse: {
    id: (change) => change.subscription.id,
    event: (change) => change.type,
  },
  doc: {
    summary: 'Лента изменений реестра подписок (SSE)',
    tags: ['ops'],
  },
  pipeline: compose(noValidationPipeline, tracked),
  deps: [SubscriptionRegistry],
  handle:
    (registry: SubscriptionRegistry) =>
    async (
      _payload: unknown,
      meta: { subscription: TrackedSubscription },
    ): Output<AsyncIterable<SubscriptionChange>> => {
      const feed = registry.watch(meta.subscription.signal);

      return new Ok(
        (async function* () {
          for await (const event of feed) {
            yield {
              type: event.type,
              reason: event.type === 'closed' ? event.reason : undefined,
              subscription: toWire(event.info),
            };
          }
        })(),
      );
    },
});
