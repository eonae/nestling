/**
 * Общий набор проверок на реализации в памяти.
 *
 * `InMemoryOutboxStore` здесь — эталон: набор один, и прогон на нём
 * показывает, что проверяется семантика интерфейса, а не особенности
 * адаптера. Тот же набор гоняется на адаптере в `e2e/`.
 */

import type { StoreHarness } from './__fixtures__/store-suite.js';
import { describeOutboxStore } from './__fixtures__/store-suite.js';

import { InMemoryOutboxStore } from '@nestlingjs/outbox';

/** Транзакция реализации в памяти: точка, в которой запись видна */
class ImmediateTransaction {
  onCommit(action: () => void): void {
    action();
  }
}

describeOutboxStore('OutboxStore: реализация в памяти', (): StoreHarness => {
  const store = new InMemoryOutboxStore();

  return {
    store,
    append: async (records) => {
      await store.append(new ImmediateTransaction(), records);
    },
  };
});
