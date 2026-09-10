/**
 * Relay: один проход, повторы, порядок раздела и остановка.
 *
 * Таймеров здесь нет: цикл разложен на два уровня, и тест зовёт `drain()`
 * сам. Единственный тест, которому нужен цикл, — остановка: она и есть
 * его предмет.
 */

import { FakeBus } from './__fixtures__/bus.js';
import { TestTransaction } from './__fixtures__/transaction.js';
import type { OutboxConfigValues } from './config.js';
import { InMemoryOutboxStore } from './memory-store.js';
import type { OutboxPublishedFact, OutboxStuckFact } from './operations.js';
import { OutboxRelay } from './relay.js';
import type { OutboxRecord } from './types.js';

import { describe, expect, it } from '@jest/globals';
import type { Emitter } from '@nestlingjs/operations';
import { spyLogger } from '@nestlingjs/testing';

/** Конфиг relay: повторов без пауз хватает, чтобы тест не ждал таймера */
const config = (
  overrides: Partial<OutboxConfigValues> = {},
): OutboxConfigValues => ({
  pollIntervalMs: 0,
  batchSize: 100,
  backoffMs: 0,
  backoffMaxMs: 0,
  maxAttempts: 10,
  relay: true,
  ...overrides,
});

/** Эмиттер факта, копящий payload'ы */
function factSpy<T>(): Emitter<any> & { readonly emitted: T[] } {
  const emitted: T[] = [];

  return {
    emitted,
    emit: async (payload?: unknown) => {
      emitted.push(payload as T);
    },
  };
}

/** Ворота: промис, который тест открывает руками */
function deferred(): { promise: Promise<void>; open: () => void } {
  const resolvers: { resolve?: () => void } = {};

  const promise = new Promise<void>((resolve) => {
    resolvers.resolve = resolve;
  });

  return { promise, open: (): void => resolvers.resolve?.() };
}

let sequence = 0;

function makeRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  sequence += 1;

  return {
    id: `rec-${sequence}`,
    subject: 'relay.spec.event',
    payload: { n: sequence },
    durable: true,
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Relay поверх хранилища с уже закоммиченными записями */
async function setup(
  records: readonly OutboxRecord[],
  overrides: Partial<OutboxConfigValues> = {},
) {
  const store = new InMemoryOutboxStore();
  const tx = new TestTransaction();

  await store.append(tx, records);
  tx.commit();

  const bus = new FakeBus();
  const published = factSpy<OutboxPublishedFact>();
  const stuck = factSpy<OutboxStuckFact>();

  const relay = await OutboxRelay.acquire({
    store,
    bus,
    config: config(overrides),
    logger: spyLogger().logger,
    published,
    stuck,
  });

  return { store, bus, relay, published, stuck };
}

describe('drain: доставка', () => {
  it('публикует запись с ключом идемпотентности и признаком долговечности', async () => {
    const record = makeRecord();
    const { bus, relay } = await setup([record]);

    const report = await relay.drain();

    expect(report).toEqual({
      claimed: 1,
      published: 1,
      retried: 0,
      stuck: 0,
    });
    expect(bus.published).toEqual([
      {
        subject: record.subject,
        payload: record.payload,
        options: { idempotencyKey: record.id, durable: true },
      },
    ]);
  });

  it('пустое хранилище — проход вхолостую', async () => {
    const { relay, bus } = await setup([]);

    expect(await relay.drain()).toEqual({
      claimed: 0,
      published: 0,
      retried: 0,
      stuck: 0,
    });
    expect(bus.published).toHaveLength(0);
  });

  it('отмечает запись опубликованной: второй проход её не берёт', async () => {
    const { relay, store, bus } = await setup([makeRecord()]);

    await relay.drain();
    await relay.drain();

    expect(bus.published).toHaveLength(1);
    expect(store.snapshot()[0].state).toBe('published');
  });

  it('везёт переданный контекст вызова конвертом', async () => {
    const record = makeRecord({ context: { tenantId: 'acme' } });
    const { relay, bus } = await setup([record]);

    await relay.drain();

    expect(bus.published[0].options?.context).toEqual({ tenantId: 'acme' });
  });

  it('публикует факт `outbox.published`', async () => {
    const record = makeRecord();
    const { relay, published } = await setup([record]);

    await relay.drain();

    expect(published.emitted).toHaveLength(1);
    expect(published.emitted[0]).toMatchObject({
      id: record.id,
      subject: record.subject,
      attempts: 0,
      createdAt: record.createdAt,
    });
  });
});

describe('drain: повторы', () => {
  it('повторяет запись с тем же ключом идемпотентности', async () => {
    const record = makeRecord();
    const { relay, bus } = await setup([record]);

    bus.failing.add(record.subject);
    const failed = await relay.drain();

    bus.failing.clear();
    const succeeded = await relay.drain();

    expect(failed).toMatchObject({ published: 0, retried: 1 });
    expect(succeeded).toMatchObject({ published: 1 });
    expect(bus.published).toHaveLength(1);
    expect(bus.published[0].options?.idempotencyKey).toBe(record.id);
  });

  it('считает попытки: повтор приходит с увеличенным счётчиком', async () => {
    const record = makeRecord();
    const { relay, store, bus } = await setup([record]);

    bus.failing.add(record.subject);
    await relay.drain();

    expect(store.snapshot()[0].attempts).toBe(1);
  });

  it('после исчерпания попыток отмечает запись застрявшей', async () => {
    const record = makeRecord();
    const { relay, store, bus, stuck } = await setup([record], {
      maxAttempts: 1,
    });

    bus.failing.add(record.subject);
    const report = await relay.drain();

    expect(report).toMatchObject({ stuck: 1, published: 0 });
    expect(store.snapshot()[0].state).toBe('stuck');
    expect(stuck.emitted[0]).toMatchObject({
      id: record.id,
      attempts: 1,
      reason: expect.stringContaining('failed'),
    });
  });

  it('застрявшая запись больше не выдаётся', async () => {
    const record = makeRecord();
    const { relay, bus } = await setup([record], { maxAttempts: 1 });

    bus.failing.add(record.subject);
    await relay.drain();
    bus.failing.clear();

    expect(await relay.drain()).toMatchObject({ claimed: 0 });
  });
});

describe('drain: порядок раздела', () => {
  it('не публикует вторую запись раздела, пока не прошла первая', async () => {
    const first = makeRecord({ partitionKey: 'user-1' });
    const second = makeRecord({ partitionKey: 'user-1' });
    const { relay, bus } = await setup([first, second]);

    bus.failing.add(first.subject);
    await relay.drain();

    expect(bus.published).toHaveLength(0);
  });

  it('запись, до которой очередь не дошла, попыток не тратит', async () => {
    const first = makeRecord({ partitionKey: 'user-1' });
    const second = makeRecord({ partitionKey: 'user-1' });
    const { relay, store, bus } = await setup([first, second]);

    bus.failing.add(first.subject);
    await relay.drain();

    const [, held] = store.snapshot();

    expect(held.attempts).toBe(0);
  });

  it('отказ одного раздела не задерживает другой', async () => {
    const failing = makeRecord({
      partitionKey: 'user-1',
      subject: 'relay.spec.failing',
    });
    const other = makeRecord({ partitionKey: 'user-2' });
    const { relay, bus } = await setup([failing, other]);

    bus.failing.add(failing.subject);
    await relay.drain();

    expect(bus.published.map((message) => message.subject)).toEqual([
      other.subject,
    ]);
  });

  it('публикует записи раздела в порядке создания', async () => {
    const first = makeRecord({ partitionKey: 'user-1' });
    const second = makeRecord({ partitionKey: 'user-1' });
    const { relay, bus } = await setup([first, second]);

    await relay.drain();

    expect(bus.published.map((message) => message.payload)).toEqual([
      first.payload,
      second.payload,
    ]);
  });
});

describe('остановка', () => {
  it('дописывает партию: `release()` ждёт конца прохода', async () => {
    const { relay, store, bus } = await setup([makeRecord()]);
    const controller = new AbortController();

    const gate = deferred();

    bus.gate = gate.promise;

    relay.run(controller.signal);

    // Цикл дошёл до публикации и стоит на ней
    await Promise.resolve();
    controller.abort();

    let released = false;
    const stopping = relay.release().then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBe(false);

    gate.open();
    await stopping;

    expect(bus.published).toHaveLength(1);
    expect(store.snapshot()[0].state).toBe('published');
  });

  it('процесс с выключенным relay задачи не запускает', async () => {
    const { relay, bus } = await setup([makeRecord()], { relay: false });
    const controller = new AbortController();

    expect(relay.enabled).toBe(false);

    relay.run(controller.signal);
    await relay.release();

    expect(bus.published).toHaveLength(0);
  });
});
