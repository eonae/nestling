/* eslint-disable unicorn/no-useless-undefined --
 * Реализация контракта без `output` возвращает `undefined` явно: так
 * записан контракт хендлера в ядре (`Output<undefined>`). */
import type { ILoggerService } from '../logger';
import { ILogger } from '../logger';

import { implement } from '@nestling/ports';
import {
  SubscriptionClosed,
  SubscriptionOpened,
} from '@nestling/subscriptions';

/**
 * Подписчик на факт «подписка открыта».
 *
 * Реестр публикует факты жизненного цикла подписок `event`-контрактами,
 * и любая фича слушает их как обычный подписчик. Так собирается картина
 * по всему кластеру: каждый узел публикует свои факты. Приёмник с
 * хранилищем («кто подписывался вчера») пишется здесь же, без изменений в
 * реестре.
 *
 * Управление при этом остаётся локальным: `abort` действует только в
 * своём процессе. Шина не даёт ни scatter-gather, ни широковещательной
 * подписки без queue-group.
 */
export const SubscriptionOpenedInOps = implement(SubscriptionOpened, {
  subscriber: 'ops',
  deps: [ILogger],
  handle:
    (logger: ILoggerService) =>
    async (payload: {
      node?: string;
      id: string;
      transport: string;
      pattern: string;
    }) => {
      logger.log(
        `[subscriptions] ${payload.node ?? 'local'}: открыта ${payload.id} ` +
          `(${payload.transport} ${payload.pattern})`,
      );

      return undefined;
    },
});

/** Подписчик на факт «подписка закрыта»; `reason` задаёт реестр */
export const SubscriptionClosedInOps = implement(SubscriptionClosed, {
  subscriber: 'ops',
  deps: [ILogger],
  handle:
    (logger: ILoggerService) =>
    async (payload: {
      node?: string;
      id: string;
      reason: string;
      itemsOut: number;
    }) => {
      logger.log(
        `[subscriptions] ${payload.node ?? 'local'}: закрыта ${payload.id} — ` +
          `${payload.reason}, отдано ${payload.itemsOut}`,
      );

      return undefined;
    },
});
