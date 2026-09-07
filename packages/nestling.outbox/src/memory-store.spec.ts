/**
 * Интерфейс хранилища, проверенный на реализации в памяти.
 *
 * Проверяются обещания самого интерфейса — те, которые адаптер к базе
 * обязан повторить: партия не выдаётся дважды, порядок раздела держится
 * выдачей, `settle` идемпотентен.
 */

import { TestTransaction } from './__fixtures__/transaction.js';
import { InMemoryOutboxStore } from './memory-store.js';
import type { OutboxRecord } from './types.js';

import { describe, expect, it } from '@jest/globals';

let sequence = 0;

/** Запись с предсказуемым идентификатором и моментом создания */
function makeRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  sequence += 1;

  return {
    id: `r-${sequence}`,
    subject: 'store.spec.event',
    payload: { n: sequence },
    durable: false,
    createdAt: sequence,
    ...overrides,
  };
}

/** Хранилище с уже закоммиченными записями */
async function storeWith(
  records: readonly OutboxRecord[],
): Promise<InMemoryOutboxStore> {
  const store = new InMemoryOutboxStore();
  const tx = new TestTransaction();

  await store.append(tx, records);
  tx.commit();

  return store;
}

/** Момент, позже любого `createdAt` фикстур */
const NOW = 1_000_000;

describe('OutboxStore.append', () => {
  it('требует от транзакции точку коммита', async () => {
    const store = new InMemoryOutboxStore();

    await expect(store.append({}, [makeRecord()])).rejects.toThrow(/onCommit/);
  });
});

describe('OutboxStore.claim', () => {
  it('не выдаёт одну партию дважды', async () => {
    const store = await storeWith([makeRecord(), makeRecord()]);

    const first = await store.claim({ limit: 10, now: NOW });
    const second = await store.claim({ limit: 10, now: NOW });

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(0);
  });

  it('выдаёт не больше запрошенного', async () => {
    const store = await storeWith([makeRecord(), makeRecord(), makeRecord()]);

    expect(await store.claim({ limit: 2, now: NOW })).toHaveLength(2);
  });

  it('не выдаёт запись раньше её `availableAt`', async () => {
    const record = makeRecord();
    const store = await storeWith([record]);

    await store.claim({ limit: 10, now: NOW });
    await store.settle([
      { status: 'retry', id: record.id, attempts: 1, availableAt: NOW + 100 },
    ]);

    expect(await store.claim({ limit: 10, now: NOW })).toHaveLength(0);
    expect(await store.claim({ limit: 10, now: NOW + 100 })).toHaveLength(1);
  });

  it('держит очередь раздела: обогнать ждущую запись нельзя', async () => {
    const first = makeRecord({ partitionKey: 'user-1' });
    const second = makeRecord({ partitionKey: 'user-1' });
    const other = makeRecord({ partitionKey: 'user-2' });
    const store = await storeWith([first, second, other]);

    await store.claim({ limit: 10, now: NOW });
    await store.settle([
      { status: 'retry', id: first.id, attempts: 1, availableAt: NOW + 100 },
      { status: 'retry', id: second.id, attempts: 0, availableAt: NOW },
      { status: 'published', id: other.id },
    ]);

    const claimed = await store.claim({ limit: 10, now: NOW });

    // Вторая запись раздела ждёт первую, хотя сама доступна
    expect(claimed).toHaveLength(0);
  });

  it('выдаёт записи раздела подряд и в порядке создания', async () => {
    const first = makeRecord({ partitionKey: 'user-1' });
    const second = makeRecord({ partitionKey: 'user-1' });
    const store = await storeWith([first, second]);

    const claimed = await store.claim({ limit: 10, now: NOW });

    expect(claimed.map((record) => record.id)).toEqual([first.id, second.id]);
  });

  it('отдаёт число провалившихся попыток вместе с записью', async () => {
    const record = makeRecord();
    const store = await storeWith([record]);

    await store.claim({ limit: 10, now: NOW });
    await store.settle([
      { status: 'retry', id: record.id, attempts: 3, availableAt: NOW },
    ]);

    const [claimed] = await store.claim({ limit: 10, now: NOW });

    expect(claimed.attempts).toBe(3);
  });
});

describe('OutboxStore.settle', () => {
  it('идемпотентен: повтор той же партии ничего не меняет', async () => {
    const record = makeRecord();
    const store = await storeWith([record]);

    await store.claim({ limit: 10, now: NOW });
    const outcomes = [
      {
        status: 'retry' as const,
        id: record.id,
        attempts: 1,
        availableAt: NOW,
      },
    ];

    await store.settle(outcomes);
    await store.settle(outcomes);

    expect(store.snapshot()[0].attempts).toBe(1);
  });

  it('отметка `published` окончательна: запись больше не выдаётся', async () => {
    const record = makeRecord();
    const store = await storeWith([record]);

    await store.claim({ limit: 10, now: NOW });
    await store.settle([{ status: 'published', id: record.id }]);

    expect(await store.claim({ limit: 10, now: NOW })).toHaveLength(0);
    expect(store.snapshot()[0].state).toBe('published');
  });

  it('отметка `stuck` тоже окончательна', async () => {
    const record = makeRecord();
    const store = await storeWith([record]);

    await store.claim({ limit: 10, now: NOW });
    await store.settle([{ status: 'stuck', id: record.id }]);

    expect(await store.claim({ limit: 10, now: NOW })).toHaveLength(0);
    expect(store.snapshot()[0].state).toBe('stuck');
  });

  it('не знает записи — не падает', async () => {
    const store = await storeWith([]);

    await expect(
      store.settle([{ status: 'published', id: 'нет такой' }]),
    ).resolves.toBeUndefined();
  });
});
