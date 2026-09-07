/**
 * Транзакция-фикстура: то, что в приложении даёт драйвер базы данных.
 *
 * Пакет своей транзакции не заводит — её объявляет приложение. Здесь она
 * ровно такая, какой её видит хранилище в памяти: точка коммита и точка
 * отката.
 */

import type { StagingTransaction } from '../memory-store.js';

import { contextVar } from '@nestling/app';

/** Транзакция тестов: отложенные действия плюс коммит и откат */
export class TestTransaction implements StagingTransaction {
  readonly #actions: (() => void)[] = [];

  onCommit(action: () => void): void {
    this.#actions.push(action);
  }

  /** Выполняет отложенное; после этого записи видны хранилищу */
  commit(): void {
    for (const action of this.#actions) {
      action();
    }

    this.#actions.length = 0;
  }

  /** Забывает отложенное: записи так и не появятся */
  rollback(): void {
    this.#actions.length = 0;
  }
}

/** Переменная транзакции тестов; в приложении её объявляет приложение */
export const Tx = contextVar<TestTransaction>()('tx');
