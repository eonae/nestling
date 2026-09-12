/**
 * Общий набор проверок хранилища отметок.
 *
 * Один файл на две реализации: `InMemoryInboxStore` этого пакета и
 * адаптер к базе. Расхождение семантики между ними — дефект, поэтому
 * обещания интерфейса проверяются одним текстом, а не двумя похожими.
 *
 * Адаптер подключает этот же файл относительным путём: набор живёт рядом
 * с интерфейсом, который он описывает.
 */

import type { InboxClaim, InboxMark, InboxStore } from '../types.js';

import { beforeEach, describe, expect, it } from '@jest/globals';

/** Реализация под проверкой и то, чем тест открывает транзакцию */
export interface InboxStoreHarness {
  /** Хранилище */
  readonly store: InboxStore;

  /**
   * Открывает транзакцию, отдаёт её телу и закрывает названным исходом.
   *
   * Отметка ставится транзакцией вызывающего, поэтому набор проверок не
   * может звать `claim` напрямую: транзакция принадлежит реализации.
   */
  run<T>(
    outcome: 'commit' | 'rollback',
    body: (transaction: unknown) => Promise<T>,
  ): Promise<T>;

  /**
   * Убирает отметки прошлой проверки.
   *
   * Необязателен: реализация, которая создаётся заново на каждую
   * проверку, убирать ничего не должна.
   */
  clear?(): Promise<void>;
}

/** Момент, позже любого `receivedAt` фикстур */
export const NOW = 1_800_000_000_000;

let sequence = 0;

/** Отметка с предсказуемой парой и моментом постановки */
export function makeInboxMark(overrides: Partial<InboxMark> = {}): InboxMark {
  sequence += 1;

  return {
    consumer: 'store.suite.event@subscriber',
    key: `k-${sequence}-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: 1_700_000_000_000 + sequence,
    ...overrides,
  };
}

/**
 * Объявляет набор проверок для одной реализации.
 *
 * @param title - Имя реализации в отчёте
 * @param open - Открывает реализацию; вызывается перед каждой проверкой
 */
export function describeInboxStore(
  title: string,
  open: () => InboxStoreHarness | Promise<InboxStoreHarness>,
): void {
  describe(title, () => {
    let harness: InboxStoreHarness;

    /** Ставит отметку и коммитит, как это сделал бы успешный запрос */
    const claim = async (mark: InboxMark): Promise<InboxClaim> =>
      harness.run('commit', (transaction) =>
        harness.store.claim(transaction, mark),
      );

    beforeEach(async () => {
      harness = await open();
      await harness.clear?.();
    });

    it('первая доставка отмечается', async () => {
      expect(await claim(makeInboxMark())).toBe('claimed');
    });

    it('повтор той же пары узнаётся', async () => {
      const mark = makeInboxMark();

      expect(await claim(mark)).toBe('claimed');
      expect(await claim(mark)).toBe('duplicate');
    });

    it('два потребителя с одним ключом дедуплицируют независимо', async () => {
      const key = makeInboxMark().key;

      expect(await claim(makeInboxMark({ consumer: 'a@one', key }))).toBe(
        'claimed',
      );
      expect(await claim(makeInboxMark({ consumer: 'b@two', key }))).toBe(
        'claimed',
      );
    });

    it('два ключа одного потребителя не мешают друг другу', async () => {
      const consumer = 'one.consumer@sub';

      expect(await claim(makeInboxMark({ consumer }))).toBe('claimed');
      expect(await claim(makeInboxMark({ consumer }))).toBe('claimed');
    });

    it('откат убирает отметку', async () => {
      const mark = makeInboxMark();

      const outcome = await harness.run('rollback', (transaction) =>
        harness.store.claim(transaction, mark),
      );

      expect(outcome).toBe('claimed');
      expect(await claim(mark)).toBe('claimed');
    });

    it('проход удаляет отметки старше срока', async () => {
      const old = makeInboxMark({ receivedAt: NOW - 10_000 });
      await claim(old);

      const removed = await harness.store.sweep({
        olderThan: NOW - 5000,
        limit: 100,
      });

      expect(removed).toBe(1);
      expect(await claim(old)).toBe('claimed');
    });

    it('проход не трогает свежие отметки', async () => {
      const fresh = makeInboxMark({ receivedAt: NOW - 1000 });
      await claim(fresh);

      const removed = await harness.store.sweep({
        olderThan: NOW - 5000,
        limit: 100,
      });

      expect(removed).toBe(0);
      expect(await claim(fresh)).toBe('duplicate');
    });

    it('проход удаляет не больше запрошенного', async () => {
      await claim(makeInboxMark({ receivedAt: NOW - 10_000 }));
      await claim(makeInboxMark({ receivedAt: NOW - 10_000 }));
      await claim(makeInboxMark({ receivedAt: NOW - 10_000 }));

      expect(
        await harness.store.sweep({ olderThan: NOW - 5000, limit: 2 }),
      ).toBe(2);
    });

    it('проход по пустой таблице удаляет ноль', async () => {
      expect(await harness.store.sweep({ olderThan: NOW, limit: 100 })).toBe(0);
    });
  });
}
