/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`). */
/**
 * Транспорт целиком — против двойника брокера, без сети.
 *
 * Предмет проверки: адресация и группы, конверт в headers, потолок
 * ожидания, отображение брокерских отказов, фазовая раскладка и дренаж.
 */

import type { NatsDouble } from './testing/double.js';
import { NatsDouble as Broker, natsDouble } from './testing/double.js';
import type { NatsTransportOptions } from './transport.js';
import { nats, NatsBus } from './transport.js';
import { CONTEXT_HEADER, IDEMPOTENCY_HEADER, TIMEOUT_HEADER } from './wire.js';

import { describe, expect, it } from '@jest/globals';
import { makeCommand, makeEvent, makeRequest } from '@nestling/operations';
import { defineFail, makePipeline, Ok } from '@nestling/pipeline';
import { BusTransport$, implement } from '@nestling/ports';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

const QuotaExceeded = defineFail('QUOTA_EXCEEDED', {
  status: 'CONFLICT',
  message: 'Quota exceeded',
});

const Claim = makeRequest({
  name: 'quotas.claim',
  input: z.object({ amount: z.number() }),
  output: z.object({ granted: z.number() }),
  errors: [QuotaExceeded],
});

const Ship = makeCommand({
  name: 'orders.ship',
  input: z.object({ orderId: z.string() }),
});

const Placed = makeEvent({
  name: 'orders.placed',
  input: z.object({ orderId: z.string() }),
});

let claimed: number[] = [];
let shipped: string[] = [];
let notified: string[] = [];
let seenAttributes: Record<string, unknown> = {};
let deny = false;

const ClaimImpl = implement(Claim, {
  pipeline: makePipeline().pre((ctx) => {
    seenAttributes = ctx.raw.attributes;
  }),
  handle: async (input) => {
    if (deny) {
      return QuotaExceeded();
    }

    claimed.push(input.amount);

    return new Ok({ granted: input.amount });
  },
});

const ShipImpl = implement(Ship, {
  pipeline: makePipeline().pre((ctx) => {
    seenAttributes = ctx.raw.attributes;
  }),
  handle: async (input) => {
    shipped.push(input.orderId);

    return undefined;
  },
});

const PlacedBilling = implement(Placed, {
  subscriber: 'billing',
  handle: async (input) => {
    notified.push(`billing:${input.orderId}`);

    return undefined;
  },
});

const PlacedAnalytics = implement(Placed, {
  subscriber: 'analytics',
  handle: async (input) => {
    notified.push(`analytics:${input.orderId}`);

    return undefined;
  },
});

/** Даёт доставке провернуться */
const settle = async (ms = 0): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

/** Процесс на общем брокере: свой транспорт, свои маршруты */
async function process(
  broker: NatsDouble,
  declarations: readonly Parameters<typeof makeDispatch>[0][number][],
  options: NatsTransportOptions = {},
): Promise<NatsBus> {
  const bus = new NatsBus({ connect: natsDouble(broker), ...options });

  await bus.connect();
  await bus.serve(makeDispatch(declarations), new AbortController().signal);

  return bus;
}

describe('NatsBus — адресация и группы', () => {
  beforeEach(() => {
    claimed = [];
    shipped = [];
    notified = [];
    seenAttributes = {};
    deny = false;
  });

  it('req-reply доходит до владельца и возвращает Ok', async () => {
    const broker = new Broker();
    const owner = await process(broker, [ClaimImpl]);
    const caller = await process(broker, []);

    const response = await caller.request('quotas.claim', { amount: 5 });

    expect(response).toMatchObject({
      isSuccess: true,
      value: { granted: 5 },
    });
    expect(claimed).toEqual([5]);

    await owner.close();
    await caller.close();
  });

  it('задекларированный отказ сохраняет код при передаче по сети', async () => {
    const broker = new Broker();
    deny = true;
    const owner = await process(broker, [ClaimImpl]);
    const caller = await process(broker, []);

    const response = await caller.request('quotas.claim', { amount: 5 });

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'CONFLICT',
      value: { code: 'QUOTA_EXCEEDED' },
    });

    await owner.close();
    await caller.close();
  });

  it('реплики владельца делят команду', async () => {
    const broker = new Broker();
    const replicas = await Promise.all([
      process(broker, [ShipImpl]),
      process(broker, [ShipImpl]),
      process(broker, [ShipImpl]),
    ]);

    const caller = await process(broker, []);

    await caller.publish('orders.ship', { orderId: 'o-1' });
    await settle();

    expect(shipped).toEqual(['o-1']);

    for (const replica of replicas) {
      await replica.close();
    }
    await caller.close();
  });

  it('подписчики события получают по копии, реплики подписчика делят её', async () => {
    const broker = new Broker();
    const processes = await Promise.all([
      process(broker, [PlacedBilling]),
      process(broker, [PlacedBilling]),
      process(broker, [PlacedAnalytics]),
    ]);

    const caller = await process(broker, []);

    await caller.publish('orders.placed', { orderId: 'o-1' });
    await settle();

    expect(notified.sort()).toEqual(['analytics:o-1', 'billing:o-1']);

    for (const item of processes) {
      await item.close();
    }
    await caller.close();
  });

  it('префикс разделяет окружения', async () => {
    const broker = new Broker();
    const owner = await process(broker, [ClaimImpl], {
      subjectPrefix: 'staging.',
    });
    const caller = await process(broker, [], { subjectPrefix: 'staging.' });

    await caller.request('quotas.claim', { amount: 1 });

    expect(broker.published.map(({ subject }) => subject)).toContain(
      'staging.quotas.claim',
    );

    await owner.close();
    await caller.close();
  });
});

describe('NatsBus — конверт и потолок', () => {
  beforeEach(() => {
    claimed = [];
    shipped = [];
    seenAttributes = {};
    deny = false;
  });

  it('кладёт бюджет, ключ и контекст в headers', async () => {
    const broker = new Broker();
    const owner = await process(broker, [ShipImpl]);
    const caller = await process(broker, []);

    await caller.publish(
      'orders.ship',
      { orderId: 'o-1' },
      {
        timeoutMs: 500,
        idempotencyKey: 'k-1',
        context: { tenantId: 'acme' },
      },
    );
    await settle();

    const sent = broker.published.find(
      ({ subject }) => subject === 'orders.ship',
    );

    expect(sent?.headers?.get(TIMEOUT_HEADER)).toBe('500');
    expect(sent?.headers?.get(IDEMPOTENCY_HEADER)).toBe('k-1');
    expect(JSON.parse(sent?.headers?.get(CONTEXT_HEADER) ?? '{}')).toEqual({
      tenantId: 'acme',
    });

    await owner.close();
    await caller.close();
  });

  it('на приёме бюджет становится моментом, ключ и контекст — атрибутами', async () => {
    const broker = new Broker();
    const owner = await process(broker, [ShipImpl]);
    const caller = await process(broker, []);

    await caller.publish(
      'orders.ship',
      { orderId: 'o-1' },
      {
        timeoutMs: 500,
        idempotencyKey: 'k-1',
        context: { tenantId: 'acme' },
      },
    );
    await settle();

    expect(seenAttributes).toMatchObject({
      subject: 'orders.ship',
      idempotencyKey: 'k-1',
      tenantId: 'acme',
    });
    expect(seenAttributes.deadline).toBeInstanceOf(Date);

    await owner.close();
    await caller.close();
  });

  it('провозимый ключ переменной переживает канонизацию заголовков', async () => {
    const broker = new Broker();
    const owner = await process(broker, [ShipImpl]);
    const caller = await process(broker, []);

    await caller.publish(
      'orders.ship',
      { orderId: 'o-1' },
      { context: { tenantId: 'acme', traceId: 'trace-1' } },
    );
    await settle();

    // Именно camelCase: ключ переменной это имя поля накопленного input
    expect(seenAttributes.tenantId).toBe('acme');
    expect(seenAttributes.traceId).toBe('trace-1');

    await owner.close();
    await caller.close();
  });

  it("исчерпанный в транзите бюджет не доводит сообщение до endpoint'а", async () => {
    const broker = new Broker();
    const owner = await process(broker, [ClaimImpl]);
    const caller = await process(broker, []);

    const response = await caller.request(
      'quotas.claim',
      { amount: 5 },
      { timeoutMs: -1 },
    );

    expect(response).toMatchObject({
      isSuccess: false,
      value: { code: 'DEADLINE_EXCEEDED' },
    });
    expect(claimed).toEqual([]);

    await owner.close();
    await caller.close();
  });

  it('вызов без бюджета ограничен потолком транспорта', async () => {
    const broker = new Broker();
    const caller = await process(broker, [], { requestTimeout: 20 });

    // Подписчик есть, но молчит: истечёт именно потолок
    broker.subscribe('quotas.claim', {
      queue: 'owner:quotas.claim',
      callback: () => {
        /* ответа не будет */
      },
    });

    const response = await caller.request('quotas.claim', { amount: 1 });

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'TIMEOUT',
      value: { code: 'DEADLINE_EXCEEDED' },
    });
    expect(String((response.value as { error?: string }).error)).toContain(
      'NATS_REQUEST_TIMEOUT',
    );

    await caller.close();
  });

  it('бюджет меньше потолка — вызов завершается по бюджету', async () => {
    const broker = new Broker();
    const caller = await process(broker, [], { requestTimeout: 30_000 });

    broker.subscribe('quotas.claim', {
      queue: 'owner:quotas.claim',
      callback: () => {
        /* ответа не будет */
      },
    });

    const started = Date.now();
    const response = await caller.request(
      'quotas.claim',
      { amount: 1 },
      { timeoutMs: 25 },
    );

    expect(Date.now() - started).toBeLessThan(1000);
    expect(String((response.value as { error?: string }).error)).toContain(
      'call budget',
    );

    await caller.close();
  });
});

describe('NatsBus — отказы доставки и фазы', () => {
  it('никто не слушает subject — SERVICE_UNAVAILABLE с адресом', async () => {
    const broker = new Broker();
    const caller = await process(broker, [], {
      onDeliveryFailure: () => {
        /* отказ ожидаем: тест смотрит на ответ */
      },
    });

    const response = await caller.request('quotas.claim', { amount: 1 });

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'SERVICE_UNAVAILABLE',
    });
    expect(String((response.value as { error?: string }).error)).toContain(
      'quotas.claim',
    );

    await caller.close();
  });

  it('attach проверяет формы io и подписок не заводит', async () => {
    const broker = new Broker();
    const bus = new NatsBus({ connect: natsDouble(broker) });

    await bus.connect();
    bus.attach(makeDispatch([ClaimImpl]));

    // Маршруты запомнены, эфира нет: запрос некому обслужить
    await expect(
      broker.request('quotas.claim', new TextEncoder().encode('{}'), {
        timeout: 20,
      }),
    ).rejects.toMatchObject({ code: '503' });

    await bus.close();
  });

  it('дренаж снимает подписки', async () => {
    const broker = new Broker();
    const owner = await process(broker, [ClaimImpl]);

    await owner.close();

    await expect(
      broker.request('quotas.claim', new TextEncoder().encode('{}'), {
        timeout: 20,
      }),
    ).rejects.toMatchObject({ code: '503' });
  });

  it('объявляет способности значением: value-формы, remote, durable', async () => {
    const bus = new NatsBus({ connect: natsDouble(new Broker()) });

    expect([...bus.capabilities.input]).toEqual(['value']);
    expect([...bus.capabilities.output]).toEqual(['value']);
    expect(bus.remote).toBe(true);
    expect(bus.durable).toBe(true);
  });

  it('фабрика регистрирует транспорт под токеном шины', () => {
    expect(nats().token).toBe(BusTransport$);
  });
});
