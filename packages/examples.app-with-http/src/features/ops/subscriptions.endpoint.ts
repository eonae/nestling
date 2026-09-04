import { Unauthorized } from '../../errors.js';
import { authed } from '../../plugins/auth/index.js';
import { observability } from '../../plugins/logging/index.js';

import { Injectable } from '@nestling/container';
import { events, makeFail, Ok } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { compose } from '@nestling/pipeline';
import type {
  SubscriptionInfo,
  TrackedSubscription,
} from '@nestling/subscriptions';
import { SubscriptionRegistry, tracked } from '@nestling/subscriptions';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

/** Подписка в ответе API: то же, что отдаёт `registry.list()` */
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

type Subscription = z.infer<typeof Subscription>;

/** Событие ленты реестра в ответе API */
const SubscriptionChange = z.object({
  type: z.enum(['opened', 'closed']),
  reason: z.string().optional(),
  subscription: Subscription,
});

type SubscriptionChange = z.infer<typeof SubscriptionChange>;

/**
 * Подписка не найдена на этом узле.
 *
 * Реестр ведётся в каждом процессе отдельно, и `abort` действует только
 * в своём процессе.
 */
export const SubscriptionNotFound = makeFail('not_found:subscription', {
  details: z.object({ id: z.string() }),
  message: (d) => `Subscription ${d.id} is not active on this node`,
});

/** Переводит запись реестра в форму ответа API */
const toWire = (info: SubscriptionInfo): Subscription => ({
  id: info.id,
  transport: info.transport,
  pattern: info.pattern,
  kind: info.kind,
  identity: info.identity,
  labels: { ...info.labels },
  startedAt: info.startedAt,
  itemsOut: info.itemsOut,
});

@Injectable([SubscriptionRegistry])
class ListSubscriptionsHandler {
  constructor(private readonly registry: SubscriptionRegistry) {}

  async handle(): Output<Subscription[]> {
    return this.registry.list().map((info) => toWire(info));
  }
}

/** Список активных подписок узла. Реестр инжектируется обычным токеном */
export const ListSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/ops/subscriptions',
  output: z.array(Subscription),
  doc: { summary: 'Активные подписки этого узла', tags: ['ops'] },
  pipeline: observability,
  handler: ListSubscriptionsHandler,
});

@Injectable([SubscriptionRegistry])
class KillSubscriptionHandler {
  constructor(private readonly registry: SubscriptionRegistry) {}

  async handle(payload: {
    id: string;
  }): Output<null, typeof SubscriptionNotFound> {
    const killed = this.registry.abort(payload.id, 'administrative kill');

    return killed ? Ok.noContent() : SubscriptionNotFound({ id: payload.id });
  }
}

/**
 * Административное завершение подписки.
 *
 * `abort` подаёт сигнал отмены. Запись из реестра снимает `.finally`
 * пайплайна, когда поток закроется.
 */
export const KillSubscription = httpEndpoint({
  method: 'DELETE',
  path: '/ops/subscriptions/:id',
  input: z.object({ id: z.string() }),
  errors: [SubscriptionNotFound, Unauthorized],
  doc: { summary: 'Завершить подписку', tags: ['ops'], status: 'no_content' },
  pipeline: authed,
  handler: KillSubscriptionHandler,
});

@Injectable([SubscriptionRegistry])
class WatchSubscriptionsHandler {
  constructor(private readonly registry: SubscriptionRegistry) {}

  async handle(
    _payload: unknown,
    meta: { subscription: TrackedSubscription },
  ): Output<AsyncIterable<SubscriptionChange>> {
    const feed = this.registry.watch(meta.subscription.signal);

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
  }
}

/**
 * Лента изменений реестра: сама является подпиской.
 *
 * Endpoint композирован от `tracked`, поэтому попадает в реестр, который
 * показывает. Своё событие `opened` он не видит: оно опубликовано до
 * вызова хендлера.
 */
export const WatchSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/ops/subscriptions/live',
  output: events(SubscriptionChange),
  sse: {
    id: (change) => change.subscription.id,
    event: (change) => change.type,
  },
  doc: { summary: 'Лента изменений реестра подписок (SSE)', tags: ['ops'] },
  pipeline: compose(observability, tracked),
  handler: WatchSubscriptionsHandler,
});
