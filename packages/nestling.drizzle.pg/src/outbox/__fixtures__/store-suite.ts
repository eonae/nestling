/**
 * Общий набор проверок хранилища записей.
 *
 * Один файл на две реализации: `InMemoryOutboxStore` из
 * `@nestlingjs/outbox` и адаптер этого пакета. Расхождение семантики
 * между ними — дефект, поэтому обещания интерфейса проверяются одним
 * текстом, а не двумя похожими.
 *
 * Прогон на адаптере требует работающего PostgreSQL и пропускается без
 * адреса базы в окружении.
 */

import { beforeEach, describe, expect, it } from '@jest/globals';
import type { OutboxRecord, OutboxStore } from '@nestlingjs/outbox';

/** Реализация под проверкой и то, чем тест кладёт в неё записи */
export interface StoreHarness {
  /** Хранилище */
  readonly store: OutboxStore;

  /** Кладёт записи так, как их положил бы запрос: вместе с коммитом */
  append(records: readonly OutboxRecord[]): Promise<void>;

  /**
   * Убирает записи прошлого теста.
   *
   * Необязателен: реализация, которая создаётся заново на каждую
   * проверку, убирать ничего не должна.
   */
  clear?(): Promise<void>;
}

/** Момент, позже любого `createdAt` фикстур */
export const NOW = 1_800_000_000_000;

let sequence = 0;

/** Запись с предсказуемым идентификатором и моментом создания */
export function makeOutboxRecord(
  overrides: Partial<OutboxRecord> = {},
): OutboxRecord {
  sequence += 1;

  return {
    id: `r-${sequence}-${Math.random().toString(36).slice(2, 8)}`,
    subject: 'store.suite.event',
    payload: { n: sequence },
    durable: false,
    createdAt: 1_700_000_000_000 + sequence,
    ...overrides,
  };
}

/**
 * Объявляет набор проверок для одной реализации.
 *
 * @param title - Имя реализации в отчёте
 * @param open - Открывает реализацию; вызывается перед каждой проверкой
 */
export function describeOutboxStore(
  title: string,
  open: () => StoreHarness | Promise<StoreHarness>,
): void {
  describe(title, () => {
    let harness: StoreHarness;

    beforeEach(async () => {
      harness = await open();
      await harness.clear?.();
    });

    it('не выдаёт одну партию дважды', async () => {
      await harness.append([makeOutboxRecord(), makeOutboxRecord()]);

      const first = await harness.store.claim({ limit: 10, now: NOW });
      const second = await harness.store.claim({ limit: 10, now: NOW });

      expect(first).toHaveLength(2);
      expect(second).toHaveLength(0);
    });

    it('выдаёт не больше запрошенного', async () => {
      await harness.append([
        makeOutboxRecord(),
        makeOutboxRecord(),
        makeOutboxRecord(),
      ]);

      expect(await harness.store.claim({ limit: 2, now: NOW })).toHaveLength(2);
    });

    it('не выдаёт запись раньше её момента готовности', async () => {
      const record = makeOutboxRecord();
      await harness.append([record]);

      await harness.store.claim({ limit: 10, now: NOW });
      await harness.store.settle([
        { status: 'retry', id: record.id, attempts: 1, availableAt: NOW + 100 },
      ]);

      expect(await harness.store.claim({ limit: 10, now: NOW })).toHaveLength(
        0,
      );
      expect(
        await harness.store.claim({ limit: 10, now: NOW + 100 }),
      ).toHaveLength(1);
    });

    it('держит очередь раздела: обогнать ждущую запись нельзя', async () => {
      const first = makeOutboxRecord({ partitionKey: 'user-1' });
      const second = makeOutboxRecord({ partitionKey: 'user-1' });
      const other = makeOutboxRecord({ partitionKey: 'user-2' });
      await harness.append([first, second, other]);

      await harness.store.claim({ limit: 10, now: NOW });
      await harness.store.settle([
        { status: 'retry', id: first.id, attempts: 1, availableAt: NOW + 100 },
        { status: 'retry', id: second.id, attempts: 0, availableAt: NOW },
        { status: 'published', id: other.id },
      ]);

      // Вторая запись раздела ждёт первую, хотя сама доступна
      expect(await harness.store.claim({ limit: 10, now: NOW })).toHaveLength(
        0,
      );
    });

    it('выдаёт записи раздела подряд и в порядке создания', async () => {
      const first = makeOutboxRecord({ partitionKey: 'user-3' });
      const second = makeOutboxRecord({ partitionKey: 'user-3' });
      await harness.append([first, second]);

      const claimed = await harness.store.claim({ limit: 10, now: NOW });

      expect(claimed.map((record) => record.id)).toEqual([first.id, second.id]);
    });

    it('отдаёт число провалившихся попыток вместе с записью', async () => {
      const record = makeOutboxRecord();
      await harness.append([record]);

      await harness.store.claim({ limit: 10, now: NOW });
      await harness.store.settle([
        { status: 'retry', id: record.id, attempts: 3, availableAt: NOW },
      ]);

      const [claimed] = await harness.store.claim({ limit: 10, now: NOW });

      expect(claimed.attempts).toBe(3);
    });

    it('отметка исходов идемпотентна', async () => {
      const record = makeOutboxRecord();
      await harness.append([record]);

      await harness.store.claim({ limit: 10, now: NOW });
      const outcomes = [
        {
          status: 'retry' as const,
          id: record.id,
          attempts: 1,
          availableAt: NOW,
        },
      ];

      await harness.store.settle(outcomes);
      await harness.store.settle(outcomes);

      const [claimed] = await harness.store.claim({ limit: 10, now: NOW });

      expect(claimed.attempts).toBe(1);
    });

    it('отметка `published` окончательна', async () => {
      const record = makeOutboxRecord();
      await harness.append([record]);

      await harness.store.claim({ limit: 10, now: NOW });
      await harness.store.settle([{ status: 'published', id: record.id }]);

      expect(await harness.store.claim({ limit: 10, now: NOW })).toHaveLength(
        0,
      );
    });

    it('отметка `stuck` тоже окончательна', async () => {
      const record = makeOutboxRecord();
      await harness.append([record]);

      await harness.store.claim({ limit: 10, now: NOW });
      await harness.store.settle([{ status: 'stuck', id: record.id }]);

      expect(await harness.store.claim({ limit: 10, now: NOW })).toHaveLength(
        0,
      );
    });

    it('неизвестная запись не роняет отметку', async () => {
      await expect(
        harness.store.settle([{ status: 'published', id: 'нет такой' }]),
      ).resolves.toBeUndefined();
    });

    it('запись доходит до выдачи со всеми полями', async () => {
      const record = makeOutboxRecord({
        partitionKey: 'user-4',
        context: { requestId: 'req-1' },
        durable: true,
      });
      await harness.append([record]);

      const [claimed] = await harness.store.claim({ limit: 10, now: NOW });

      expect(claimed).toMatchObject({
        id: record.id,
        subject: record.subject,
        payload: record.payload,
        durable: true,
        partitionKey: 'user-4',
        context: { requestId: 'req-1' },
        createdAt: record.createdAt,
        attempts: 0,
      });
    });
  });
}
