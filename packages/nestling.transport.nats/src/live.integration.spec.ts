/* eslint-disable unicorn/no-useless-undefined --
 * Реализация контракта без `output` возвращает `undefined` явно: так
 * записан контракт хендлера в ядре (`Output<undefined>`). */
/**
 * Те же сценарии — против **живого** `nats-server`.
 *
 * Двойник проверяет наш код, а не совместимость с брокером: за
 * совместимость отвечает этот прогон, и гонять его нужно перед публикацией
 * пакета. Включается переменной `NATS_TEST_SERVERS`; без неё suite
 * пропускается целиком, поэтому `yarn verify` остаётся зелёным офлайн.
 *
 * ```bash
 * docker run --rm -p 4222:4222 nats:2 -js
 * NATS_TEST_SERVERS=nats://127.0.0.1:4222 yarn workspace @nestling/transport.nats test
 * ```
 */

import { NatsBus } from './transport.js';

import { describe, expect, it } from '@jest/globals';
import { makeContract } from '@nestling/contracts';
import { defineFail, makePipeline, Ok } from '@nestling/pipeline';
import { implement } from '@nestling/ports';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

const servers = process.env.NATS_TEST_SERVERS;

/**
 * Префикс прогона: живой брокер переживает тест, и subject'ы соседних
 * прогонов не должны пересекаться. Берётся из окружения, а не чеканится
 * случайно, — тесту нужен детерминизм.
 */
const prefix = `nltest-${process.pid}.`;

const QuotaExceeded = defineFail('QUOTA_EXCEEDED', {
  status: 'CONFLICT',
  message: 'Quota exceeded',
});

const Claim = makeContract({
  name: 'live.quotas.claim',
  kind: 'request',
  input: z.object({ amount: z.number() }),
  output: z.object({ granted: z.number() }),
  errors: [QuotaExceeded],
});

const Ship = makeContract({
  name: 'live.orders.ship',
  kind: 'command',
  input: z.object({ orderId: z.string() }),
});

const Placed = makeContract({
  name: 'live.orders.placed',
  kind: 'event',
  durable: true,
  input: z.object({ orderId: z.string() }),
});

let shipped: string[] = [];
let archived: string[] = [];
let seenAttributes: Record<string, unknown> = {};
let deny = false;

const ClaimImpl = implement(Claim, {
  pipeline: makePipeline().pre((ctx) => {
    seenAttributes = ctx.raw.attributes;
  }),
  handle: async (input) =>
    deny ? QuotaExceeded() : new Ok({ granted: input.amount }),
});

const ShipImpl = implement(Ship, {
  handle: async (input) => {
    shipped.push(input.orderId);

    return undefined;
  },
});

const PlacedImpl = implement(Placed, {
  subscriber: 'archive',
  handle: async (input) => {
    archived.push(input.orderId);

    return undefined;
  },
});

const settle = async (ms = 100): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

async function bus(
  declarations: readonly Parameters<typeof makeDispatch>[0][number][],
): Promise<NatsBus> {
  const transport = new NatsBus({
    servers: (servers ?? '').split(','),
    subjectPrefix: prefix,
    requestTimeout: 5000,
  });

  await transport.connect();
  await transport.serve(
    makeDispatch(declarations),
    new AbortController().signal,
  );

  return transport;
}

const suite = servers ? describe : describe.skip;

suite('живой брокер', () => {
  beforeEach(() => {
    shipped = [];
    archived = [];
    seenAttributes = {};
    deny = false;
  });

  it('req-reply доходит и возвращает Ok', async () => {
    const owner = await bus([ClaimImpl]);
    const caller = await bus([]);

    const response = await caller.request('live.quotas.claim', { amount: 7 });

    expect(response).toMatchObject({ isSuccess: true, value: { granted: 7 } });

    await owner.close();
    await caller.close();
  });

  it('задекларированный отказ сохраняет код при передаче по сети', async () => {
    deny = true;
    const owner = await bus([ClaimImpl]);
    const caller = await bus([]);

    const response = await caller.request('live.quotas.claim', { amount: 1 });

    expect(response).toMatchObject({ value: { code: 'QUOTA_EXCEEDED' } });

    await owner.close();
    await caller.close();
  });

  it('конверт передаётся: бюджет, ключ и провозимый контекст', async () => {
    const owner = await bus([ClaimImpl]);
    const caller = await bus([]);

    await caller.request(
      'live.quotas.claim',
      { amount: 1 },
      { timeoutMs: 2000, context: { tenantId: 'acme' } },
    );

    // Ключ переменной обязан прийти буквально: заголовки канонизируются,
    // и именно поэтому контекст передаётся значением, а не именем заголовка
    expect(seenAttributes.tenantId).toBe('acme');
    expect(seenAttributes.deadline).toBeInstanceOf(Date);

    await owner.close();
    await caller.close();
  });

  it('реплики владельца делят команду', async () => {
    const replicas = await Promise.all([bus([ShipImpl]), bus([ShipImpl])]);
    const caller = await bus([]);

    await caller.publish('live.orders.ship', { orderId: 'o-1' });
    await settle();

    expect(shipped).toEqual(['o-1']);

    for (const replica of replicas) {
      await replica.close();
    }
    await caller.close();
  });

  it('долговечное событие переживает простой подписчика', async () => {
    const publisher = await bus([]);

    await publisher.publish(
      'live.orders.placed',
      { orderId: 'o-1' },
      { durable: true },
    );

    const subscriber = await bus([PlacedImpl]);
    await settle(300);

    expect(archived).toContain('o-1');

    await subscriber.close();
    await publisher.close();
  });

  it('вызов недоступного владельца отвечает SERVICE_UNAVAILABLE', async () => {
    const caller = await bus([]);

    const response = await caller.request('live.quotas.claim', { amount: 1 });

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'SERVICE_UNAVAILABLE',
    });

    await caller.close();
  });
});
