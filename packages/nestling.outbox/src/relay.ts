/**
 * Relay: фоновая задача, которая разбирает записи и публикует их в шину.
 *
 * Relay — ресурс, а не компонент. Фаза SHUTDOWN взводит сигнал `@OnStart`,
 * а затем освобождает ресурсы в обратном топологическом порядке, и
 * завершения фоновой задачи компонента при этом никто не ждёт. Relay же
 * обязан дописать партию до того, как закроется хранилище: `release()`
 * дожидается конца текущего прохода, а зависимость от хранилища ставит
 * relay раньше него в порядке освобождения.
 */

import type { OutboxConfigValues } from './config.js';
import type { OutboxPublished, OutboxStuck } from './operations.js';
import type { ClaimedRecord, OutboxSettlement, OutboxStore } from './types.js';

import type { IMessageBus, Logger } from '@nestlingjs/app';
import { makeToken, OnStart } from '@nestlingjs/container';
import type { Emitter } from '@nestlingjs/operations';

/** DI-токен relay: тест берёт по нему `drain()`, приложение — ничего */
export const OutboxRelay$ = makeToken<OutboxRelay>('@nestlingjs/outbox:relay');

/** Итог одного прохода по партии */
export interface OutboxDrainReport {
  /** Сколько записей выдало хранилище */
  readonly claimed: number;

  /** Сколько опубликовано */
  readonly published: number;

  /** Сколько вернулось в очередь */
  readonly retried: number;

  /** Сколько отмечено застрявшими */
  readonly stuck: number;
}

/** Всё, что нужно relay для работы; собирает провайдер плагина */
export interface OutboxRelayOptions {
  readonly store: OutboxStore;
  readonly bus: IMessageBus;
  readonly config: OutboxConfigValues;
  readonly logger: Logger;
  readonly published: Emitter<typeof OutboxPublished>;
  readonly stuck: Emitter<typeof OutboxStuck>;
}

/**
 * Разбивает партию на разделы, сохраняя порядок создания.
 *
 * Запись без раздела образует раздел из себя одной: порядка у неё нет ни
 * с кем.
 */
function partitionsOf(batch: readonly ClaimedRecord[]): ClaimedRecord[][] {
  const partitions: ClaimedRecord[][] = [];
  const byKey = new Map<string, ClaimedRecord[]>();

  for (const record of batch) {
    if (record.partitionKey === undefined) {
      partitions.push([record]);
      continue;
    }

    const known = byKey.get(record.partitionKey);

    if (known) {
      known.push(record);
      continue;
    }

    const started = [record];
    byKey.set(record.partitionKey, started);
    partitions.push(started);
  }

  return partitions;
}

/** Текст отказа для факта «застряла» */
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Relay записей outbox'а.
 *
 * Цикл разложен на два уровня: {@link drain} выполняет один проход по
 * партии, а `@OnStart` повторяет его до сигнала. Так тест детерминирован:
 * тестовая сборка останавливается после фазы WIRE и `@OnStart` не
 * выполняет, поэтому проход вызывается вручную и таймера ждать не нужно.
 *
 * @example
 * ```typescript
 * const relay = app.get(OutboxRelay$);
 * const report = await relay.drain();
 * ```
 */
export class OutboxRelay {
  /** Конструирует relay; зависимости собирает провайдер плагина */
  static async acquire(options: OutboxRelayOptions): Promise<OutboxRelay> {
    return new OutboxRelay(options);
  }

  readonly #options: OutboxRelayOptions;

  /** Цикл, запущенный `@OnStart`; `undefined`, пока он не запущен */
  #loop?: Promise<void>;

  /** Взводится `release()`: цикл заканчивается на границе прохода */
  #stopped = false;

  /** Прерывает паузу между проходами */
  #wake?: () => void;

  private constructor(options: OutboxRelayOptions) {
    this.#options = options;
  }

  /** Крутит ли этот процесс relay; решает поле `relay` секции конфига */
  get enabled(): boolean {
    return this.#options.config.relay;
  }

  /**
   * Запускает цикл. Хук возвращает управление сразу: фаза START ждёт
   * каждый `@OnStart`, и цикл, выполненный внутри хука, не дал бы
   * приложению стартовать.
   *
   * @param signal - Сигнал остановки приложения
   */
  @OnStart()
  run(signal: AbortSignal): void {
    if (!this.enabled || this.#loop) {
      return;
    }

    this.#loop = this.#poll(signal);
  }

  /**
   * Один проход по партии: выборка, публикация, отметка исходов.
   *
   * Публичный, потому что тест вызывает его сам. Цикла внутри нет.
   *
   * @returns Что случилось с записями партии
   */
  async drain(): Promise<OutboxDrainReport> {
    const { store, config } = this.#options;
    const now = Date.now();

    const batch = await store.claim({ limit: config.batchSize, now });

    if (batch.length === 0) {
      return { claimed: 0, published: 0, retried: 0, stuck: 0 };
    }

    const settlements: OutboxSettlement[] = [];
    const publishedRecords: ClaimedRecord[] = [];
    const stuckRecords: { record: ClaimedRecord; reason: string }[] = [];

    for (const partition of partitionsOf(batch)) {
      // Раздел обрывается на первом отказе: следующая запись не
      // публикуется, пока не опубликована предыдущая
      let broken = false;

      for (const record of partition) {
        if (broken) {
          settlements.push({
            status: 'retry',
            id: record.id,
            attempts: record.attempts,
            availableAt: now,
          });
          continue;
        }

        try {
          await this.#publish(record);
          settlements.push({ status: 'published', id: record.id });
          publishedRecords.push(record);
        } catch (error) {
          broken = true;
          const attempts = record.attempts + 1;

          if (attempts >= config.maxAttempts) {
            settlements.push({ status: 'stuck', id: record.id });
            stuckRecords.push({ record, reason: reasonOf(error) });
            continue;
          }

          settlements.push({
            status: 'retry',
            id: record.id,
            attempts,
            availableAt: now + this.#backoff(attempts),
          });
        }
      }
    }

    await store.settle(settlements);
    await this.#report(publishedRecords, stuckRecords);

    return {
      claimed: batch.length,
      published: publishedRecords.length,
      stuck: stuckRecords.length,
      retried: batch.length - publishedRecords.length - stuckRecords.length,
    };
  }

  /**
   * Останавливает relay и дожидается конца текущего прохода.
   *
   * Зовёт его контейнер на SHUTDOWN. Порядок освобождения обратный
   * топологическому, а relay зависит от хранилища, поэтому хранилище
   * закрывается после него.
   */
  async release(): Promise<void> {
    this.#stopped = true;
    this.#wake?.();

    await this.#loop;
  }

  /** Публикует запись; ключ идемпотентности равен её идентификатору */
  async #publish(record: ClaimedRecord): Promise<void> {
    await this.#options.bus.publish(record.subject, record.payload, {
      idempotencyKey: record.id,
      durable: record.durable,
      ...(record.context === undefined ? {} : { context: record.context }),
    });
  }

  /** Пауза перед повтором: удвоение с потолком */
  #backoff(attempts: number): number {
    const { backoffMs, backoffMaxMs } = this.#options.config;

    return Math.min(backoffMs * 2 ** (attempts - 1), backoffMaxMs);
  }

  /**
   * Публикует факты партии.
   *
   * Отказ факта не роняет проход: наблюдение не должно останавливать
   * доставку. Молча он не теряется — уходит в лог.
   */
  async #report(
    published: readonly ClaimedRecord[],
    stuck: readonly { record: ClaimedRecord; reason: string }[],
  ): Promise<void> {
    const at = Date.now();

    for (const record of published) {
      await this.#fact(() =>
        this.#options.published.emit({
          id: record.id,
          subject: record.subject,
          ...(record.partitionKey === undefined
            ? {}
            : { partitionKey: record.partitionKey }),
          attempts: record.attempts,
          createdAt: record.createdAt,
          publishedAt: at,
        }),
      );
    }

    for (const { record, reason } of stuck) {
      this.#options.logger.error('outbox record is stuck', {
        id: record.id,
        subject: record.subject,
        attempts: record.attempts + 1,
        reason,
      });

      await this.#fact(() =>
        this.#options.stuck.emit({
          id: record.id,
          subject: record.subject,
          ...(record.partitionKey === undefined
            ? {}
            : { partitionKey: record.partitionKey }),
          attempts: record.attempts + 1,
          createdAt: record.createdAt,
          stuckAt: at,
          reason,
        }),
      );
    }
  }

  /** Публикует один факт, гася его отказ */
  async #fact(emit: () => Promise<void>): Promise<void> {
    try {
      await emit();
    } catch (error) {
      this.#options.logger.warn('outbox fact was not published', {
        error: reasonOf(error),
      });
    }
  }

  /** Цикл: проход за проходом, пока не взведён сигнал */
  async #poll(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !this.#stopped) {
      let claimed = 0;

      try {
        const report = await this.drain();

        claimed = report.claimed;
      } catch (error) {
        // Отказ хранилища не должен убивать цикл: следующий проход
        // повторит выборку
        this.#options.logger.error('outbox drain failed', {
          error: reasonOf(error),
        });
      }

      if (signal.aborted || this.#stopped) {
        return;
      }

      // Пауза только на пустой партии: пока записи есть, разбор идёт
      // без задержек
      if (claimed === 0) {
        await this.#pause(signal);
      }
    }
  }

  /** Пауза между проходами; прерывается сигналом и остановкой */
  async #pause(signal: AbortSignal): Promise<void> {
    const { pollIntervalMs } = this.#options.config;

    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        this.#wake = undefined;
        resolve();
      };

      const timer = setTimeout(done, pollIntervalMs);

      this.#wake = done;
      signal.addEventListener('abort', done, { once: true });
    });
  }
}
