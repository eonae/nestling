/**
 * Факты работы relay — обычные `event`-операции.
 *
 * Наблюдение за outbox'ом не требует от ядра ни строки: факт публикуется
 * тем же эмиттером, что любое другое событие, а приёмник живёт в своей
 * фиче и подписывается обычным `implement(OutboxPublished, { … })`.
 * Приложение без подписчиков собирается и работает: у события ноль
 * подписчиков легален.
 */

import type { StandardSchemaV1 } from '@nestlingjs/common.misc';
import type { EventOperation } from '@nestlingjs/operations';
import { makeEvent } from '@nestlingjs/operations';
import { z } from 'zod';

/** Полезная нагрузка факта «запись опубликована» */
export interface OutboxPublishedFact {
  /** Идентификатор записи; он же ключ идемпотентности публикации */
  readonly id: string;

  /** Subject операции */
  readonly subject: string;

  /** Раздел записи, если он у неё был */
  readonly partitionKey?: string;

  /** Сколько попыток провалилось до этой */
  readonly attempts: number;

  /** Момент создания записи, epoch-миллисекунды */
  readonly createdAt: number;

  /** Момент публикации, epoch-миллисекунды */
  readonly publishedAt: number;
}

/** Полезная нагрузка факта «запись застряла» */
export interface OutboxStuckFact {
  readonly id: string;
  readonly subject: string;
  readonly partitionKey?: string;

  /** Сколько попыток исчерпано */
  readonly attempts: number;

  readonly createdAt: number;

  /** Момент отметки, epoch-миллисекунды */
  readonly stuckAt: number;

  /** Текст последнего отказа публикации */
  readonly reason?: string;
}

/**
 * Схемы фактов: значение написано на zod, объявленный тип — нейтральный.
 *
 * Тип операции уходит в публичные объявления пакета, и вендор в нём
 * называть нельзя: приложение подписывается на факт, не выбирая
 * валидатора. Значение при этом остаётся zod-схемой, поэтому штатный
 * конвертер переводит её в JSON Schema без аннотации.
 */
const publishedSchema: StandardSchemaV1<unknown, OutboxPublishedFact> =
  z.object({
    id: z.string(),
    subject: z.string(),
    partitionKey: z.string().optional(),
    attempts: z.number(),
    createdAt: z.number(),
    publishedAt: z.number(),
  });

/** Схема факта «запись застряла» — тем же правилом */
const stuckSchema: StandardSchemaV1<unknown, OutboxStuckFact> = z.object({
  id: z.string(),
  subject: z.string(),
  partitionKey: z.string().optional(),
  attempts: z.number(),
  createdAt: z.number(),
  stuckAt: z.number(),
  reason: z.string().optional(),
});

/**
 * Факт: запись опубликована.
 *
 * Разница `publishedAt - createdAt` и есть задержка доставки — та цена,
 * которую платит приложение за то, что событие переживает падение
 * процесса.
 */
export const OutboxPublished: EventOperation<
  StandardSchemaV1<unknown, OutboxPublishedFact>,
  undefined,
  []
> = makeEvent({
  name: 'outbox.published',
  input: publishedSchema,
  doc: {
    summary: 'Outbox record published',
    description:
      'Published by the relay once the record has reached the bus. The ' +
      'gap between `publishedAt` and `createdAt` is the delivery delay.',
  },
});

/**
 * Факт: запись застряла.
 *
 * Попытки исчерпаны, и сама по себе запись больше не поедет. Это точка
 * вмешательства: подписчик поднимает алерт, а разбирается человек.
 */
export const OutboxStuck: EventOperation<
  StandardSchemaV1<unknown, OutboxStuckFact>,
  undefined,
  []
> = makeEvent({
  name: 'outbox.stuck',
  input: stuckSchema,
  doc: {
    summary: 'Outbox record stuck',
    description:
      'Published by the relay once the publish attempts are exhausted. ' +
      'The record stays in the store and is no longer handed out.',
  },
});
