/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`). */
/**
 * Те же сценарии — против **живого** `nats-server`.
 *
 * Двойник проверяет наш код, а не совместимость с брокером: за
 * совместимость отвечает этот прогон, и гонять его нужно перед публикацией
 * пакета. Включается переменной `NATS_TEST_SERVERS`; без неё suite
 * пропускается целиком, поэтому `yarn verify` остаётся зелёным офлайн.
 *
 * Брокер, переменную и остановку службы берёт на себя команда репозитория:
 *
 * ```bash
 * yarn test:live
 * ```
 */

import { NatsBus } from './transport.js';

import type { Logger } from '@nestlingjs/app';
import {
  implement,
  makeDispatch,
  makeFail,
  makePipeline,
  Ok,
} from '@nestlingjs/app';
import { makeCommand, makeEvent, makeRequest } from '@nestlingjs/operations';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const servers = process.env.NATS_TEST_SERVERS;

/**
 * Префикс прогона: живой брокер переживает тест, и subject'ы соседних
 * прогонов не должны пересекаться. Берётся из окружения, а не чеканится
 * случайно, — тесту нужен детерминизм.
 */
const prefix = `nltest-${process.pid}.`;

const QuotaExceeded = makeFail('conflict:quota_exceeded', {
  message: 'Quota exceeded',
});

const Claim = makeRequest({
  name: 'live.quotas.claim',
  input: z.object({ amount: z.number() }),
  output: z.object({ granted: z.number() }),
  errors: [QuotaExceeded],
});

const Ship = makeCommand({
  name: 'live.orders.ship',
  input: z.object({ orderId: z.string() }),
});

const Placed = makeEvent({
  name: 'live.orders.placed',
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
  handler: async (input) =>
    deny ? QuotaExceeded() : new Ok({ granted: input.amount }),
});

const ShipImpl = implement(Ship, {
  handler: async (input) => {
    shipped.push(input.orderId);

    return undefined;
  },
});

const PlacedImpl = implement(Placed, {
  subscriber: 'archive',
  handler: async (input) => {
    archived.push(input.orderId);

    return undefined;
  },
});

/** Логгер живого прогона: пишет записи в stderr одной строкой на запись */
const liveLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: (...args: unknown[]) =>
    process.stderr.write(`warn ${JSON.stringify(args)}\n`),
  error: (...args: unknown[]) =>
    process.stderr.write(`error ${JSON.stringify(args)}\n`),
  child: () => liveLogger,
};

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
    // Живой брокер: записи об отказах доставки интересны в выводе прогона
    logger: liveLogger,
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

    expect(response).toMatchObject({
      value: { code: 'conflict:quota_exceeded' },
    });

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

  it('повтор долговечной публикации снимается окном потока', async () => {
    const publisher = await bus([]);

    // Ровно то, что делает relay outbox'а после неполученного
    // подтверждения: та же запись публикуется с тем же ключом
    for (let attempt = 0; attempt < 2; attempt++) {
      await publisher.publish(
        'live.orders.placed',
        { orderId: 'o-dup' },
        { durable: true, idempotencyKey: `dup-${process.pid}` },
      );
    }

    const subscriber = await bus([PlacedImpl]);
    await settle(300);

    expect(archived.filter((orderId) => orderId === 'o-dup')).toHaveLength(1);

    await subscriber.close();
    await publisher.close();
  });

  it('вызов недоступного владельца отвечает SERVICE_UNAVAILABLE', async () => {
    const caller = await bus([]);

    const response = await caller.request('live.quotas.claim', { amount: 1 });

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'service_unavailable',
    });

    await caller.close();
  });
});
