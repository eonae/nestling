/**
 * Хранилище отметок в памяти — для тестов и примеров.
 *
 * Адаптеров к базам данных пакет не поставляет: адаптер и транзакция
 * обязаны быть на одном соединении, поэтому его пишет приложение. Эта
 * реализация нужна там, где базы нет вовсе: в спеках пакета и в тестовой
 * сборке приложения.
 */

import type {
  InboxClaim,
  InboxMark,
  InboxStore,
  InboxSweepOptions,
} from './types.js';

/**
 * Транзакция, которую понимает хранилище в памяти.
 *
 * Своей транзакции пакет не заводит: её тип объявляет приложение. Здесь
 * названо минимальное, чего хранилищу в памяти достаточно, — точка
 * отката. Отметка видна сразу, как строка в открытой транзакции базы, а
 * откат её убирает.
 */
export interface RollbackAwareTransaction {
  /** Регистрирует действие, которое выполнится при откате */
  onRollback(action: () => void): void;
}

/** Проверяет, что транзакция даёт точку отката */
function assertRollbackAware(
  value: unknown,
): asserts value is RollbackAwareTransaction {
  if (
    typeof (value as RollbackAwareTransaction | null)?.onRollback !== 'function'
  ) {
    throw new TypeError(
      `InMemoryInboxStore.claim(transaction, …): the transaction must ` +
        `expose 'onRollback(action)' — the in-memory store has no connection ` +
        `to enlist in, so it needs the point at which the mark disappears. ` +
        `Either implement that method on the transaction value, or supply a ` +
        `store adapter of your own for the real database.`,
    );
  }
}

/** Ключ отметки: пара «потребитель и ключ идемпотентности» */
const idOf = (mark: Pick<InboxMark, 'consumer' | 'key'>): string =>
  JSON.stringify([mark.consumer, mark.key]);

/**
 * Хранилище отметок в памяти.
 *
 * Семантику интерфейса повторяет адаптер к базе, и расхождение между
 * реализациями — дефект: обещания проверяются одним набором.
 *
 * @example
 * ```typescript
 * const store = new InMemoryInboxStore();
 *
 * const app = await assembleTest(application, {
 *   stubs: [[InboxStore$, store]],
 * });
 * ```
 */
export class InMemoryInboxStore implements InboxStore {
  /** Отметки по составному ключу; значение — момент постановки */
  readonly #marks = new Map<string, number>();

  /** Сколько отметок хранилище держит сейчас */
  get size(): number {
    return this.#marks.size;
  }

  /** Есть ли отметка у этой пары; читает только тест */
  has(consumer: string, key: string): boolean {
    return this.#marks.has(idOf({ consumer, key }));
  }

  async claim(transaction: unknown, mark: InboxMark): Promise<InboxClaim> {
    assertRollbackAware(transaction);

    const id = idOf(mark);

    if (this.#marks.has(id)) {
      return 'duplicate';
    }

    this.#marks.set(id, mark.receivedAt);
    transaction.onRollback(() => this.#marks.delete(id));

    return 'claimed';
  }

  async sweep(options: InboxSweepOptions): Promise<number> {
    let removed = 0;

    for (const [id, receivedAt] of this.#marks) {
      if (removed >= options.limit) {
        break;
      }

      if (receivedAt < options.olderThan) {
        this.#marks.delete(id);
        removed += 1;
      }
    }

    return removed;
  }
}
