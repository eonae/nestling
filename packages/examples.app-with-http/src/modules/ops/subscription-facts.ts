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
 * Наблюдение за подписками — обычная подписка на факты.
 *
 * Это положительный результат замера: чтобы видеть подписки **всего
 * кластера**, реестру не нужно ни строки в ядре и ни одного собственного
 * механизма — факт публикуется `event`-контрактом, а слушает его та фича,
 * которой это нужно. Приёмник с хранилищем («кто подписывался вчера»)
 * пишется здесь же и реестра не касается.
 *
 * Управление при этом остаётся node-local: `abort` действует в своём
 * процессе, потому что шина V1 не даёт ни scatter-gather, ни
 * широковещательной подписки без queue-group.
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

/** Тот же приём для закрытия: причина приезжает словарём реестра */
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
