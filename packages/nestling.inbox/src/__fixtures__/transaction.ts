/**
 * Транзакция-фикстура: то, что в приложении даёт драйвер базы данных.
 *
 * Пакет своей транзакции не заводит — её объявляет приложение. Здесь она
 * ровно такая, какой её видит хранилище в памяти: точка отката плюс
 * коммит, который отложенное забывает.
 */

import type { RollbackAwareTransaction } from '../memory-store.js';

import { contextVar } from '@nestlingjs/app';

/** Транзакция тестов: отложенные откаты плюс коммит */
export class TestTransaction implements RollbackAwareTransaction {
  readonly #undo: (() => void)[] = [];

  onRollback(action: () => void): void {
    this.#undo.push(action);
  }

  /** Забывает отложенное: отметки остаются */
  commit(): void {
    this.#undo.length = 0;
  }

  /** Выполняет отложенное: отметок этой транзакции больше нет */
  rollback(): void {
    for (const action of this.#undo) {
      action();
    }

    this.#undo.length = 0;
  }
}

/** Переменная транзакции тестов; в приложении её объявляет приложение */
export const Tx = contextVar<TestTransaction>()('tx');
