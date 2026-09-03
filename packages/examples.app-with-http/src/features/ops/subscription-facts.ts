import type { Logger } from '../../plugins/logging';
import { Logger$ } from '../../plugins/logging';

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

export const SubscriptionOpenedInOps = implement(SubscriptionOpened, {
  subscriber: 'ops',
  handler: {
    deps: [Logger$],
    handle:
      (logger: Logger) =>
      async (payload: {
        node?: string;
        id: string;
        transport: string;
        pattern: string;
      }) => {
        logger.log(
          `[subscriptions] ${payload.node ?? 'local'}: opened ${payload.id} ` +
            `(${payload.transport} ${payload.pattern})`,
        );

        // eslint-disable-next-line unicorn/no-useless-undefined
        return undefined;
      },
  },
});

export const SubscriptionClosedInOps = implement(SubscriptionClosed, {
  subscriber: 'ops',
  handler: {
    deps: [Logger$],
    handle:
      (logger: Logger) =>
      async (payload: {
        node?: string;
        id: string;
        reason: string;
        itemsOut: number;
      }) => {
        logger.log(
          `[subscriptions] ${payload.node ?? 'local'}: closed ${payload.id}: ` +
            `${payload.reason}, ${payload.itemsOut.toString()} items`,
        );

        // eslint-disable-next-line unicorn/no-useless-undefined
        return undefined;
      },
  },
});
