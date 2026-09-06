import type { Logger } from '@nestling/app';
import { implement, Logger$ } from '@nestling/app';
import { Handler } from '@nestling/container';
import {
  SubscriptionClosed,
  SubscriptionOpened,
} from '@nestling/subscriptions';

/**
 * Подписчики фактов реестра.
 *
 * Реестр публикует открытие и закрытие подписок событиями, и любая фича
 * слушает их как обычный подписчик. Так собирается картина по всем
 * процессам: каждый узел публикует свои факты.
 */

@Handler([Logger$.auto])
class SubscriptionOpenedInOpsHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: {
    node?: string;
    id: string;
    transport: string;
    pattern: string;
  }) {
    this.logger.info('subscription opened', {
      node: payload.node ?? 'local',
      id: payload.id,
      transport: payload.transport,
      pattern: payload.pattern,
    });
  }
}

export const SubscriptionOpenedInOps = implement(SubscriptionOpened, {
  subscriber: 'ops',
  handler: SubscriptionOpenedInOpsHandler,
});

@Handler([Logger$.auto])
class SubscriptionClosedInOpsHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: {
    node?: string;
    id: string;
    reason: string;
    itemsOut: number;
  }) {
    this.logger.info('subscription closed', {
      node: payload.node ?? 'local',
      id: payload.id,
      reason: payload.reason,
      itemsOut: payload.itemsOut,
    });
  }
}

export const SubscriptionClosedInOps = implement(SubscriptionClosed, {
  subscriber: 'ops',
  handler: SubscriptionClosedInOpsHandler,
});
