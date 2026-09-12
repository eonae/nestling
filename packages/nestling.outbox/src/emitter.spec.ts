/**
 * Транзакционный эмиттер: запись идёт в транзакцию вызывающего.
 *
 * Тесты здесь юнитовые: эмиттеру нужны хранилище и ридер переменной, а
 * контейнер для этого не обязателен. Сборку приложения проверяет
 * `plugin.spec.ts`.
 */

import { TestTransaction, Tx } from './__fixtures__/transaction.js';
import { makeOutboxEmitter, outboxed } from './emitter.js';
import { OutboxTransactionMissingError } from './errors.js';
import { InMemoryOutboxStore } from './memory-store.js';

import { describe, expect, it } from '@jest/globals';
import type { CtxReader } from '@nestlingjs/app';
import { isFail } from '@nestlingjs/app';
import { makeCommand, makeEvent } from '@nestlingjs/operations';
import { z } from 'zod';

const UserCreated = makeEvent({
  name: 'emitter.spec.user-created',
  input: z.object({ id: z.string(), email: z.string() }),
});

const SendReceipt = makeCommand({
  name: 'emitter.spec.send-receipt',
  input: z.object({ orderId: z.string() }),
  durable: true,
});

/** Ридер переменной поверх обычного значения: контекста запроса тут нет */
const reader = (value: unknown): CtxReader<unknown> => ({
  peek: () => value,
  get: () => value,
});

/** Эмиттер операции с готовой транзакцией */
function emitterFor(
  operation: typeof UserCreated | typeof SendReceipt,
  store: InMemoryOutboxStore,
  transaction?: TestTransaction,
) {
  return makeOutboxEmitter(operation, {
    store,
    transaction: reader(transaction),
    transactionKey: Tx.key,
  });
}

describe('outboxed(Op): DI-токен', () => {
  it('мемоизирован: один DI-токен на операцию', () => {
    expect(outboxed(UserCreated)).toBe(outboxed(UserCreated));
  });

  it('не совпадает с DI-токеном ядра `Op.emitter`', () => {
    expect(outboxed(UserCreated)).not.toBe(UserCreated.emitter);
  });
});

describe('emit: запись выполняется транзакцией вызывающего', () => {
  it('до коммита записи в хранилище нет, после коммита есть', async () => {
    const store = new InMemoryOutboxStore();
    const tx = new TestTransaction();

    await emitterFor(UserCreated, store, tx).emit({
      id: '1',
      email: 'alice@example.com',
    });

    expect(store.size).toBe(0);

    tx.commit();

    expect(store.size).toBe(1);
  });

  it('откат транзакции убирает запись', async () => {
    const store = new InMemoryOutboxStore();
    const tx = new TestTransaction();

    await emitterFor(UserCreated, store, tx).emit({
      id: '1',
      email: 'alice@example.com',
    });
    tx.rollback();

    expect(store.size).toBe(0);
  });

  it('собирает запись: subject, payload, durable, раздел и момент', async () => {
    const store = new InMemoryOutboxStore();
    const tx = new TestTransaction();

    const before = Date.now();
    await emitterFor(SendReceipt, store, tx).emit({ orderId: 'o-1' });
    tx.commit();

    const [{ record }] = store.snapshot();

    expect(record.subject).toBe('emitter.spec.send-receipt');
    expect(record.payload).toEqual({ orderId: 'o-1' });
    expect(record.durable).toBe(true);
    expect(record.id).toEqual(expect.any(String));
    expect(record.createdAt).toBeGreaterThanOrEqual(before);
  });

  it('кладёт раздел из места вызова', async () => {
    const store = new InMemoryOutboxStore();
    const tx = new TestTransaction();

    await emitterFor(UserCreated, store, tx).emit(
      { id: 'u-7', email: 'alice@example.com' },
      { partitionKey: 'u-7' },
    );
    tx.commit();

    expect(store.snapshot()[0].record.partitionKey).toBe('u-7');
  });

  it('запись без переданного раздела остаётся без него', async () => {
    const store = new InMemoryOutboxStore();
    const tx = new TestTransaction();

    await emitterFor(UserCreated, store, tx).emit({
      id: 'u-8',
      email: 'alice@example.com',
    });
    tx.commit();

    expect(store.snapshot()[0].record.partitionKey).toBeUndefined();
  });

  it('у события без durable признак долговечности выключен', async () => {
    const store = new InMemoryOutboxStore();
    const tx = new TestTransaction();

    await emitterFor(UserCreated, store, tx).emit({
      id: '1',
      email: 'alice@example.com',
    });
    tx.commit();

    expect(store.snapshot()[0].record.durable).toBe(false);
  });
});

describe('emit: отказы', () => {
  it('payload не по схеме не доходит до хранилища', async () => {
    const store = new InMemoryOutboxStore();
    const tx = new TestTransaction();

    const failure = await emitterFor(UserCreated, store, tx)
      .emit({ id: 42 } as never)
      .catch((error: unknown) => error);

    expect(isFail(failure)).toBe(true);
    expect(store.size).toBe(0);

    // Транзакцию тоже не тронули: откладывать было нечего
    tx.commit();
    expect(store.size).toBe(0);
  });

  it('вызов вне транзакции называет обе починки', async () => {
    const store = new InMemoryOutboxStore();

    const failure = await emitterFor(UserCreated, store)
      .emit({ id: '1', email: 'alice@example.com' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(OutboxTransactionMissingError);
    expect((failure as Error).message).toContain(`'${Tx.key}'`);
    expect((failure as Error).message).toContain('.emitter');
    expect(store.size).toBe(0);
  });
});
