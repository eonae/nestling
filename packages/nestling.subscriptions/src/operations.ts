/**
 * Факты жизненного цикла подписок — обычные `event`-операции.
 *
 * Наблюдение за подписками **всего кластера** не требует от ядра ни строки:
 * факт публикуется тем же эмиттером, что и любое другое событие, а
 * приёмник (с хранилищем, дашбордом, чем угодно) живёт в своей фиче и
 * подписывается обычным `implement(SubscriptionOpened, { subscriber: '…' })`.
 *
 * Публикация — opt-in (`makeSubscriptions({ publish: true })`): у события ноль
 * подписчиков легален, но на remote-шине каждый факт это сетевая
 * публикация, и платить ею должно быть решением композиции.
 */

import type { StandardSchemaV1 } from '@nestlingjs/common.misc';
import { makeEvent } from '@nestlingjs/operations';
import { z } from 'zod';

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
 * Схемы фактов: значение написано на zod, объявленный тип — нейтральный.
 *
 * Тип операции уходит в публичные объявления пакета, и вендор в нём
 * называть нельзя: приложение подписывается на факт, не выбирая
 * валидатора. Значение при этом остаётся zod-схемой, поэтому штатный
 * конвертер переводит её в JSON Schema без аннотации.
 */
const openedSchema: StandardSchemaV1<unknown, SubscriptionOpenedFact> =
  z.object({
    node: z.string().optional(),
    id: z.string(),
    transport: z.string(),
    pattern: z.string(),
    kind: z.enum(KINDS),
    identity: z.string().optional(),
    startedAt: z.number(),
  });

/** Схема факта «подписка закрыта» — тем же правилом */
const closedSchema: StandardSchemaV1<unknown, SubscriptionClosedFact> =
  z.object({
    node: z.string().optional(),
    id: z.string(),
    reason: z.enum(REASONS),
    itemsOut: z.number(),
    closedAt: z.number(),
  });

/**
 * Факт: подписка открыта.
 *
 * Публикуется **до** вызова хендлера, тем же порядком, что и событие ленты.
 */
export const SubscriptionOpened = makeEvent({
  name: 'subscriptions.opened',
  input: openedSchema,
  doc: {
    summary: 'Subscription opened',
    description:
      'Published by the subscription registry when a subscription is ' +
      'registered. Observation is cluster-wide: the node name travels in ' +
      'the `node` field.',
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
  input: closedSchema,
  doc: {
    summary: 'Subscription closed',
    description:
      'Published by the subscription registry when the entry is removed. ' +
      '`reason` comes from the registry vocabulary: completed | ' +
      'disconnected | aborted | failed | killed.',
  },
});
