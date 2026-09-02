/* eslint-disable unicorn/no-useless-undefined --
 * Фейк `command`/`event`-операции возвращает `undefined` явно: так записан
 * операция его реализации (`void | Promise<void>`), и пустое тело `{}`
 * читалось бы как «забыли дописать». */
/* eslint-disable unicorn/throw-new-error --
 * `UnknownError(...)` и `QuotaExceeded(...)` — вызываемые **определения**
 * `defineFail`, а не классы ошибок: `new` тут менял бы смысл записи, а имя
 * лишь выглядит классовым. */
/**
 * `stub(Operation, impl)` — валидация схемами операции, профиль вызова и
 * место стаба в сборке.
 */

import { assembleTest } from './app';
import { stub } from './stub';
import { testUnit } from './unit';

import { describe, expect, it } from '@jest/globals';
import { makeFeature } from '@nestling/app';
import { Injectable, makeToken } from '@nestling/container';
import type { CommandMeta, PortMeta } from '@nestling/contracts';
import { makeCommand, makeEvent, makeRequest } from '@nestling/contracts';
import { defineFail, Ok, UnknownError } from '@nestling/pipeline';
import type { Emitter, Port } from '@nestling/ports';
import { implement } from '@nestling/ports';
import { z } from 'zod';

/** Квота исчерпана — задекларированный отказ операции */
const QuotaExceeded = defineFail('STUB_QUOTA_EXCEEDED', {
  status: 'CONFLICT',
  message: (details: { tenantId: string }) =>
    `Quota exceeded for '${details.tenantId}'`,
  details: z.object({ tenantId: z.string() }),
});

/** Отказ, которого нет в `errors:` операции */
const NotYourTenant = defineFail('STUB_NOT_YOUR_TENANT', {
  status: 'FORBIDDEN',
  message: 'Not your tenant',
});

const ClaimQuota = makeRequest({
  name: 'stub.quotas.claim',
  input: z.object({ tenantId: z.string(), amount: z.number() }),
  output: z.object({ granted: z.number() }),
  errors: [QuotaExceeded],
});

const ChargeCard = makeRequest({
  name: 'stub.billing.charge',
  input: z.object({ amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
});

const PlaceOrder = makeCommand({
  name: 'stub.orders.place',
  input: z.object({ orderId: z.string() }),
});

const OrderPlaced = makeEvent({
  name: 'stub.orders.placed',
  input: z.object({ orderId: z.string() }),
});

/**
 * Фейк, разошедшийся с операцией.
 *
 * В TypeScript такой фейк невыразим — на то и типы. Приведение здесь и есть
 * модель JS-потребителя, ради которого существует рантайм-проверка.
 */
const drifted = <T>(value: unknown): T => value as T;

/** Момент, уже прошедший к вызову */
const expired = (): Date => new Date(Date.now() - 1000);

// ---------------------------------------------------------------------------
// Форма значения
// ---------------------------------------------------------------------------

describe('stub — фейк-вызыватель как значение', () => {
  it('даёт пару с токеном порта у операцию-запроса', () => {
    const [token] = stub(ClaimQuota, async () => ({ granted: 1 }));

    expect(token).toBe(ClaimQuota.caller);
  });

  it('даёт пару с токеном эмиттера у события', () => {
    const [token] = stub(OrderPlaced, () => undefined);

    expect(token).toBe(OrderPlaced.emitter);
  });

  it('отвергает значение, не созданное конструктором операции', () => {
    expect(() =>
      stub(drifted<typeof OrderPlaced>({ name: 'x' }), () => undefined),
    ).toThrow(/must be an operation created by makeRequest/);
  });
});

// ---------------------------------------------------------------------------
// Валидация схемами операции
// ---------------------------------------------------------------------------

describe('stub — валидация схемами операции', () => {
  it('отдаёт VALIDATION_FAILED на невалидном входе, не зовя фейк', async () => {
    const seen: unknown[] = [];
    const [, quotas] = stub(ClaimQuota, async (payload) => {
      seen.push(payload);

      return { granted: 1 };
    });

    const result = await quotas.call(drifted({ tenantId: 42, amount: 1 }));

    expect(result).toMatchObject({
      isFail: true,
      status: 'BAD_REQUEST',
      code: 'VALIDATION_FAILED',
    });
    expect(seen).toEqual([]);
  });

  it('отдаёт VALIDATION_FAILED, когда фейк разошёлся с output-схемой', async () => {
    const [, quotas] = stub(ClaimQuota, async () =>
      drifted<{ granted: number }>({ grantedAmount: 1 }),
    );

    expect(await quotas.call({ tenantId: 't1', amount: 1 })).toMatchObject({
      isFail: true,
      code: 'VALIDATION_FAILED',
    });
  });

  it('приводит голое значение к Ok, как обычный хендлер', async () => {
    const [, quotas] = stub(ClaimQuota, async ({ amount }) => ({
      granted: amount,
    }));

    expect(await quotas.call({ tenantId: 't1', amount: 3 })).toMatchObject({
      isFail: false,
      status: 'OK',
      value: { granted: 3 },
    });
  });

  it('сохраняет статус Ok, если фейк вернул его явно', async () => {
    const [, quotas] = stub(
      ClaimQuota,
      async () => new Ok('ACCEPTED', { granted: 1 }),
    );

    expect(await quotas.call({ tenantId: 't1', amount: 1 })).toMatchObject({
      isFail: false,
      status: 'ACCEPTED',
      value: { granted: 1 },
    });
  });

  it('пропускает объявленный отказ вместе с деталями', async () => {
    const [, quotas] = stub(ClaimQuota, async ({ tenantId }) =>
      QuotaExceeded({ tenantId }),
    );

    expect(await quotas.call({ tenantId: 't1', amount: 1 })).toMatchObject({
      isFail: true,
      status: 'CONFLICT',
      code: 'STUB_QUOTA_EXCEEDED',
      details: { tenantId: 't1' },
    });
  });

  it('бросает на незадекларированном коде, называя операция и допустимые', async () => {
    const [, quotas] = stub(ClaimQuota, async () =>
      drifted<{ granted: number }>(NotYourTenant()),
    );

    await expect(quotas.call({ tenantId: 't1', amount: 1 })).rejects.toThrow(
      /stub\(stub\.quotas\.claim.*'STUB_NOT_YOUR_TENANT'.*'STUB_QUOTA_EXCEEDED'.*'UNKNOWN'/s,
    );
  });

  it('пропускает kernel-код: ветка UnknownError тестируема', async () => {
    const [, quotas] = stub(ClaimQuota, async () =>
      drifted<{ granted: number }>(UnknownError()),
    );

    expect(await quotas.call({ tenantId: 't1', amount: 1 })).toMatchObject({
      isFail: true,
      code: 'UNKNOWN',
    });
  });

  it('пробрасывает не-Fail исключение фейка как есть', async () => {
    const [, quotas] = stub(ClaimQuota, async () => {
      throw new Error('the fake blew up');
    });

    await expect(quotas.call({ tenantId: 't1', amount: 1 })).rejects.toThrow(
      'the fake blew up',
    );
  });

  it('трактует брошенный отказ как возвращённый', async () => {
    const [, quotas] = stub(ClaimQuota, async ({ tenantId }) => {
      throw QuotaExceeded({ tenantId });
    });

    expect(await quotas.call({ tenantId: 't1', amount: 1 })).toMatchObject({
      isFail: true,
      code: 'STUB_QUOTA_EXCEEDED',
    });
  });
});

// ---------------------------------------------------------------------------
// Эксплуатационный профиль вызова
// ---------------------------------------------------------------------------

describe('stub — профиль вызова', () => {
  it('отдаёт DEADLINE_EXCEEDED до вызова фейка', async () => {
    const seen: unknown[] = [];
    const [, quotas] = stub(ClaimQuota, async (payload) => {
      seen.push(payload);

      return { granted: 1 };
    });

    const result = await quotas.call(
      { tenantId: 't1', amount: 1 },
      { deadline: expired() },
    );

    expect(result).toMatchObject({
      isFail: true,
      status: 'TIMEOUT',
      code: 'DEADLINE_EXCEEDED',
    });
    expect(seen).toEqual([]);
  });

  it('чеканит idempotencyKey у emit команды', async () => {
    const seen: CommandMeta[] = [];
    const [, orders] = stub(PlaceOrder, (_payload, meta) => {
      seen.push(meta);
    });

    await orders.emit({ orderId: 'o-1' });

    expect(seen[0].idempotencyKey).toEqual(expect.any(String));
    expect(seen[0].idempotencyKey).not.toBe('');
  });

  it('сохраняет ключ вызывающего', async () => {
    const seen: CommandMeta[] = [];
    const [, orders] = stub(PlaceOrder, (_payload, meta) => {
      seen.push(meta);
    });

    await orders.emit({ orderId: 'o-1' }, { idempotencyKey: 'k1' });

    expect(seen[0].idempotencyKey).toBe('k1');
  });

  it('не чеканит ключ у события', async () => {
    const seen: PortMeta[] = [];
    const [, placed] = stub(OrderPlaced, (_payload, meta) => {
      seen.push(meta);
    });

    await placed.emit({ orderId: 'o-1' });

    expect('idempotencyKey' in seen[0]).toBe(false);
  });

  it('бросает у emit: невалидный вход и исчерпанный бюджет', async () => {
    const seen: unknown[] = [];
    const [, orders] = stub(PlaceOrder, (payload) => {
      seen.push(payload);
    });

    await expect(orders.emit(drifted({ orderId: 42 }))).rejects.toMatchObject({
      isFail: true,
      code: 'VALIDATION_FAILED',
    });

    await expect(
      orders.emit({ orderId: 'o-1' }, { deadline: expired() }),
    ).rejects.toMatchObject({ isFail: true, code: 'DEADLINE_EXCEEDED' });

    expect(seen).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Место стаба в сборке
// ---------------------------------------------------------------------------

/** Фича-потребитель: инжектит вызыватель операции, которой рядом нет */
@Injectable([ClaimQuota.caller])
class QuotaConsumer {
  constructor(readonly quotas: Port<typeof ClaimQuota>) {}
}

const ConsumerFeature = makeFeature({
  name: 'orders',
  providers: [QuotaConsumer],
});

/** Фича-владелец соседнего операции — она идёт боевым путём */
let charged: number[] = [];

const BillingFeature = makeFeature({
  name: 'billing',
  endpoints: [
    implement(ChargeCard, {
      handle: async (input) => {
        charged.push(input.amount);

        return new Ok({ chargeId: `c-${input.amount}` });
      },
    }),
  ],
});

describe('stub — место в сборке', () => {
  beforeEach(() => {
    charged = [];
  });

  it('без стаба та же сборка падает проверкой достижимости', async () => {
    await expect(
      assembleTest({ features: [ConsumerFeature], select: 'orders' }),
    ).rejects.toThrow(
      /'stub\.quotas\.claim'.*no selected module implements it/s,
    );
  });

  it('со стабом фича собирается без соседа и без брокера', async () => {
    // Сборка проходит — значит боевой рецепт семейства для этого операции
    // не вызывался ни разу: его первое же действие, `assertReachable`,
    // уронило бы её (см. тест выше)
    await using app = await assembleTest({
      features: [ConsumerFeature],
      select: 'orders',
      stubs: [stub(ClaimQuota, async ({ amount }) => ({ granted: amount }))],
    });

    const consumer = app.get(QuotaConsumer);

    expect(
      await consumer?.quotas.call({ tenantId: 't1', amount: 5 }),
    ).toMatchObject({ isFail: false, value: { granted: 5 } });
  });

  it('кладёт в граф именно значение стаба', async () => {
    const entry = stub(ClaimQuota, async () => ({ granted: 1 }));

    await using app = await assembleTest({
      features: [ConsumerFeature],
      select: 'orders',
      stubs: [entry],
    });

    expect(app.get(ClaimQuota.caller)).toBe(entry[1]);
    expect(app.get(QuotaConsumer)?.quotas).toBe(entry[1]);
  });

  it('оставляет соседний операция боевому вызывателю', async () => {
    @Injectable([ChargeCard.caller, ClaimQuota.caller])
    class MixedConsumer {
      constructor(
        readonly billing: Port<typeof ChargeCard>,
        readonly quotas: Port<typeof ClaimQuota>,
      ) {}
    }

    await using app = await assembleTest({
      features: [
        makeFeature({ name: 'module:mixed', providers: [MixedConsumer] }),
        BillingFeature,
      ],
      stubs: [stub(ClaimQuota, async () => ({ granted: 7 }))],
    });

    const consumer = app.get(MixedConsumer);

    expect(await consumer?.billing.call({ amount: 3 })).toMatchObject({
      isFail: false,
      value: { chargeId: 'c-3' },
    });
    // Боевой путь прошёл через полный пайплайн реализации
    expect(charged).toEqual([3]);

    expect(
      await consumer?.quotas.call({ tenantId: 't1', amount: 1 }),
    ).toMatchObject({ isFail: false, value: { granted: 7 } });
    expect(app.stubbed).toEqual(['stub.quotas.claim']);
  });

  it('разрешён поверх реализованного операции и виден в stubbed', async () => {
    @Injectable([ChargeCard.caller])
    class BillingConsumer {
      constructor(readonly billing: Port<typeof ChargeCard>) {}
    }

    await using app = await assembleTest({
      features: [
        makeFeature({
          name: 'module:billing-consumer',
          providers: [BillingConsumer],
        }),
        BillingFeature,
      ],
      stubs: [stub(ChargeCard, async () => ({ chargeId: 'faked' }))],
    });

    expect(
      await app.get(BillingConsumer)?.billing.call({ amount: 3 }),
    ).toMatchObject({ isFail: false, value: { chargeId: 'faked' } });
    // Реализация осталась в графе неиспользуемой — так тестировать допустимо
    expect(charged).toEqual([]);
    expect(app.stubbed).toEqual(['stub.billing.charge']);
  });

  it('перечисляет застабанные операции по алфавиту, без обычных пар', async () => {
    const IClock = makeToken<{ now(): number }>('StubClock');

    @Injectable([ClaimQuota.caller, PlaceOrder.emitter])
    class BothConsumer {
      constructor(
        readonly quotas: Port<typeof ClaimQuota>,
        readonly orders: Emitter<typeof PlaceOrder>,
      ) {}
    }

    await using app = await assembleTest({
      features: [
        makeFeature({ name: 'module:both', providers: [BothConsumer] }),
      ],
      stubs: [
        stub(PlaceOrder, () => undefined),
        stub(ClaimQuota, async () => ({ granted: 1 })),
        [IClock, { now: () => 42 }],
      ],
    });

    expect(app.stubbed).toEqual(['stub.orders.place', 'stub.quotas.claim']);
  });

  it('поставляется тем же полем у testUnit', async () => {
    await using app = await testUnit(
      makeFeature({ name: 'module:isolated', providers: [QuotaConsumer] }),
      { stubs: [stub(ClaimQuota, async () => ({ granted: 2 }))] },
    );

    expect(
      await app.get(QuotaConsumer)?.quotas.call({ tenantId: 't1', amount: 1 }),
    ).toMatchObject({ isFail: false, value: { granted: 2 } });
    expect(app.stubbed).toEqual(['stub.quotas.claim']);
  });
});
