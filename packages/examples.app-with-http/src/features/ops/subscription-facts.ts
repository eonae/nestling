import type { Logger } from '../../plugins/logging/index.js';
import { Logger$ } from '../../plugins/logging/index.js';

import { Injectable } from '@nestling/container';
import { implement } from '@nestling/ports';
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

@Injectable([Logger$])
class SubscriptionOpenedInOpsHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: {
    node?: string;
    id: string;
    transport: string;
    pattern: string;
  }) {
    this.logger.log(
      `[subscriptions] ${payload.node ?? 'local'}: opened ${payload.id} ` +
        `(${payload.transport} ${payload.pattern})`,
    );

    // eslint-disable-next-line unicorn/no-useless-undefined
    return undefined;
  }
}

export const SubscriptionOpenedInOps = implement(SubscriptionOpened, {
  subscriber: 'ops',
  handler: SubscriptionOpenedInOpsHandler,
});

@Injectable([Logger$])
class SubscriptionClosedInOpsHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: {
    node?: string;
    id: string;
    reason: string;
    itemsOut: number;
  }) {
    this.logger.log(
      `[subscriptions] ${payload.node ?? 'local'}: closed ${payload.id}: ` +
        `${payload.reason}, ${payload.itemsOut.toString()} items`,
    );

    // eslint-disable-next-line unicorn/no-useless-undefined
    return undefined;
  }
}

export const SubscriptionClosedInOps = implement(SubscriptionClosed, {
  subscriber: 'ops',
  handler: SubscriptionClosedInOpsHandler,
});
