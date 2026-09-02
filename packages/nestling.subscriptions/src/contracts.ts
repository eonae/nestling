/**
 * Факты жизненного цикла подписок — обычные `event`-операции.
 *
 * Наблюдение за подписками **всего кластера** не требует от ядра ни строки:
 * факт публикуется тем же эмиттером, что и любое другое событие, а
 * приёмник (с хранилищем, дашбордом, чем угодно) живёт в своей фиче и
 * подписывается обычным `implement(SubscriptionOpened, { subscriber: '…' })`.
 *
 * Публикация — opt-in (`subscriptions({ publish: true })`): у события ноль
 * подписчиков легален, но на remote-шине каждый факт это сетевая
 * публикация, и платить ею должно быть решением композиции.
 */

import { num, optionalStr, record, str } from './schema.js';

import { makeEvent } from '@nestling/contracts';

/** Значения `kind` снимка — тем же значением их перечисляет схема факта */
const KINDS = ['value', 'stream', 'events'] as const;

/** Значения `reason` закрытия: словарь ядра плюс `killed` */
const REASONS = [
  'completed',
  'disconnected',
  'aborted',
  'failed',
  'killed',
] as const;

/** Полезная нагрузка факта «подписка открыта» */
export interface SubscriptionOpenedFact {
  /** Узел, на котором живёт подписка; задаётся опцией модуля */
  readonly node?: string;
  readonly id: string;
  readonly transport: string;
  readonly pattern: string;
  readonly kind: string;
  readonly identity?: string;
  readonly startedAt: number;
}

/** Полезная нагрузка факта «подписка закрыта» */
export interface SubscriptionClosedFact {
  readonly node?: string;
  readonly id: string;
  readonly reason: string;
  readonly itemsOut: number;
  readonly closedAt: number;
}

/**
 * Факт: подписка открыта.
 *
 * Публикуется **до** вызова хендлера, тем же порядком, что и событие ленты.
 */
export const SubscriptionOpened = makeEvent({
  name: 'subscriptions.opened',
  input: record<SubscriptionOpenedFact>({
    node: optionalStr(),
    id: str(),
    transport: str(),
    pattern: str(),
    kind: str(KINDS),
    identity: optionalStr(),
    startedAt: num(),
  }),
  doc: {
    summary: 'Подписка открыта',
    description:
      'Факт публикуется реестром подписок при регистрации подписки. ' +
      'Наблюдение кластерное: имя узла едет полем `node`.',
  },
});

/**
 * Факт: подписка закрыта.
 *
 * `reason` — словарь реестра (`Outcome` плюс `killed`), поэтому
 * административное завершение отличимо от дисконнекта и от нормального
 * конца потока.
 */
export const SubscriptionClosed = makeEvent({
  name: 'subscriptions.closed',
  input: record<SubscriptionClosedFact>({
    node: optionalStr(),
    id: str(),
    reason: str(REASONS),
    itemsOut: num(),
    closedAt: num(),
  }),
  doc: {
    summary: 'Подписка закрыта',
    description:
      'Факт публикуется реестром подписок при снятии записи. ' +
      '`reason` — словарь реестра: completed | disconnected | aborted | ' +
      'failed | killed.',
  },
});
