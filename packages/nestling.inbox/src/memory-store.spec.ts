/**
 * Общий набор проверок на реализации в памяти.
 *
 * `InMemoryInboxStore` здесь — эталон: набор один, и прогон на нём
 * показывает, что проверяется семантика интерфейса, а не особенности
 * адаптера. Тот же набор гоняется на адаптере к PostgreSQL.
 */

import type { InboxStoreHarness } from './__fixtures__/store-suite.js';
import { describeInboxStore } from './__fixtures__/store-suite.js';
import { TestTransaction } from './__fixtures__/transaction.js';
import { InMemoryInboxStore } from './memory-store.js';

import { describe, expect, it } from '@jest/globals';

describeInboxStore('InboxStore: реализация в памяти', (): InboxStoreHarness => {
  const store = new InMemoryInboxStore();

  return {
    store,
    run: async (outcome, body) => {
      const transaction = new TestTransaction();
      const result = await body(transaction);

      if (outcome === 'commit') {
        transaction.commit();
      } else {
        transaction.rollback();
      }

      return result;
    },
  };
});

describe('InMemoryInboxStore: транзакция без точки отката', () => {
  it('падает с текстом про обе починки', async () => {
    const store = new InMemoryInboxStore();

    await expect(
      store.claim({}, { consumer: 'c@s', key: 'k-1', receivedAt: Date.now() }),
    ).rejects.toThrow(/onRollback\(action\)/);
  });
});
