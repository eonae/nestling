/**
 * Факты работы relay — обычные `event`-операции.
 *
 * Наблюдение за outbox'ом не требует от ядра ни строки: факт публикуется
 * тем же эмиттером, что любое другое событие, а приёмник живёт в своей
 * фиче и подписывается обычным `implement(OutboxPublished, { … })`.
 * Приложение без подписчиков собирается и работает: у события ноль
 * подписчиков легален.
 */

import { num, optionalStr, record, str } from './schema.js';

import { makeEvent } from '@nestling/operations';

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
 * Факт: запись опубликована.
 *
 * Разница `publishedAt - createdAt` и есть задержка доставки — та цена,
 * которую платит приложение за то, что событие переживает падение
 * процесса.
 */
export const OutboxPublished = makeEvent({
  name: 'outbox.published',
  input: record<OutboxPublishedFact>({
    id: str(),
    subject: str(),
    partitionKey: optionalStr(),
    attempts: num(),
    createdAt: num(),
    publishedAt: num(),
  }),
  doc: {
    summary: 'Запись outbox опубликована',
    description:
      'Факт публикуется relay после успешной отправки записи в шину. ' +
      'Разница между `publishedAt` и `createdAt` — задержка доставки.',
  },
});

/**
 * Факт: запись застряла.
 *
 * Попытки исчерпаны, и сама по себе запись больше не поедет. Это точка
 * вмешательства: подписчик поднимает алерт, а разбирается человек.
 */
export const OutboxStuck = makeEvent({
  name: 'outbox.stuck',
  input: record<OutboxStuckFact>({
    id: str(),
    subject: str(),
    partitionKey: optionalStr(),
    attempts: num(),
    createdAt: num(),
    stuckAt: num(),
    reason: optionalStr(),
  }),
  doc: {
    summary: 'Запись outbox застряла',
    description:
      'Факт публикуется relay, когда число попыток публикации исчерпано. ' +
      'Запись остаётся в хранилище и больше не выдаётся.',
  },
});
