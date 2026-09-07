/**
 * Хранилище записей в памяти — для тестов и примеров.
 *
 * Адаптеров к базам данных пакет не поставляет: адаптер и транзакция
 * обязаны быть на одном соединении, поэтому его пишет приложение. Эта
 * реализация нужна там, где базы нет вовсе: в спеках пакета и в тестовой
 * сборке приложения.
 */

import type {
  ClaimedRecord,
  OutboxClaimOptions,
  OutboxRecord,
  OutboxSettlement,
  OutboxStore,
} from './types.js';

/**
 * Транзакция, которую понимает хранилище в памяти.
 *
 * Своей транзакции пакет не заводит: её тип объявляет приложение. Здесь
 * названо минимальное, чего хранилищу в памяти достаточно, — точка, в
 * которой запись становится видимой. Откат не отменяет ничего: он просто
 * не выполняет отложенного действия.
 */
export interface StagingTransaction {
  /** Регистрирует действие, которое выполнится при коммите */
  onCommit(action: () => void): void;
}

/** Состояние записи в хранилище */
type EntryState = 'pending' | 'claimed' | 'published' | 'stuck';

/** Запись плюс то, что о ней знает хранилище */
interface Entry {
  readonly record: OutboxRecord;
  state: EntryState;
  attempts: number;
  availableAt: number;
}

/** Снимок записи для теста: сама запись, состояние и счётчик попыток */
export interface OutboxRecordSnapshot {
  readonly record: OutboxRecord;
  readonly state: EntryState;
  readonly attempts: number;
  readonly availableAt: number;
}

/** Проверяет, что транзакция даёт точку коммита */
function assertStaging(value: unknown): asserts value is StagingTransaction {
  if (typeof (value as StagingTransaction | null)?.onCommit !== 'function') {
    throw new TypeError(
      `InMemoryOutboxStore.append(transaction, …): the transaction must ` +
        `expose 'onCommit(action)' — the in-memory store has no connection ` +
        `to enlist in, so it needs the point at which the record becomes ` +
        `visible. Either implement that method on the transaction value, or ` +
        `supply a store adapter of your own for the real database.`,
    );
  }
}

/**
 * Хранилище записей в памяти.
 *
 * Порядок раздела держится выдачей: запись с `partitionKey` не выдаётся,
 * пока предыдущая запись того же раздела не отмечена опубликованной или
 * застрявшей. Взятые в работу записи остаются взятыми до `settle` —
 * аренды и её истечения здесь нет, потому что процесс в тесте один.
 *
 * @example
 * ```typescript
 * const store = new InMemoryOutboxStore();
 *
 * const app = await assembleTest(application, {
 *   stubs: [[OutboxStore$, store]],
 * });
 * ```
 */
export class InMemoryOutboxStore implements OutboxStore {
  readonly #entries: Entry[] = [];

  /** Сколько записей хранилище держит, включая отмеченные */
  get size(): number {
    return this.#entries.length;
  }

  /** Снимки всех записей в порядке создания */
  snapshot(): readonly OutboxRecordSnapshot[] {
    return this.#entries.map((entry) => ({
      record: entry.record,
      state: entry.state,
      attempts: entry.attempts,
      availableAt: entry.availableAt,
    }));
  }

  async append(
    transaction: unknown,
    records: readonly OutboxRecord[],
  ): Promise<void> {
    assertStaging(transaction);

    // Копия списка: вызывающий волен переиспользовать свой массив, а
    // отложенное действие выполнится позже
    const staged = [...records];

    transaction.onCommit(() => {
      for (const record of staged) {
        this.#entries.push({
          record,
          state: 'pending',
          attempts: 0,
          availableAt: record.createdAt,
        });
      }
    });
  }

  async claim(options: OutboxClaimOptions): Promise<readonly ClaimedRecord[]> {
    const { limit, now } = options;
    const taken: ClaimedRecord[] = [];

    // Разделы, чья очередь занята более ранней невыданной записью:
    // выдать следующую значило бы разрешить обгон внутри раздела
    const blocked = new Set<string>();

    for (const entry of this.#entries) {
      if (taken.length >= limit) {
        break;
      }

      const { partitionKey } = entry.record;

      if (entry.state === 'published' || entry.state === 'stuck') {
        continue;
      }

      const ready = entry.state === 'pending' && entry.availableAt <= now;

      if (!ready || (partitionKey !== undefined && blocked.has(partitionKey))) {
        if (partitionKey !== undefined) {
          blocked.add(partitionKey);
        }
        continue;
      }

      entry.state = 'claimed';
      taken.push({ ...entry.record, attempts: entry.attempts });
    }

    return taken;
  }

  async settle(outcomes: readonly OutboxSettlement[]): Promise<void> {
    for (const outcome of outcomes) {
      const entry = this.#entries.find(
        (candidate) => candidate.record.id === outcome.id,
      );

      // Идемпотентность: исход применяется только к записи, взятой в
      // работу. Повторный `settle` той же партии уже ничего не меняет
      if (!entry || entry.state !== 'claimed') {
        continue;
      }

      if (outcome.status === 'retry') {
        entry.state = 'pending';
        entry.attempts = outcome.attempts;
        entry.availableAt = outcome.availableAt;
        continue;
      }

      entry.state = outcome.status;
    }
  }
}
