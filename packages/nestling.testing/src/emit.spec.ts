/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`). */
/**
 * `app.emit` — доставка факта или команды всем co-located подписчикам.
 */

import { assembleTest } from './app';
import { stub } from './stub';

import { describe, expect, it } from '@jest/globals';
import { makeFeature } from '@nestling/app';
import { makeCommand, makeEvent, makeRequest } from '@nestling/contracts';
import { makePipeline } from '@nestling/pipeline';
import { implement } from '@nestling/ports';
import { z } from 'zod';

const PlaceOrder = makeCommand({
  name: 'emit.orders.place',
  input: z.object({ orderId: z.string() }),
});

const OrderPlaced = makeEvent({
  name: 'emit.orders.placed',
  input: z.object({ orderId: z.string(), tenantId: z.string() }),
});

const Forgotten = makeEvent({
  name: 'emit.orders.forgotten',
  input: z.object({ orderId: z.string() }),
});

const Unowned = makeCommand({
  name: 'emit.orders.unowned',
  input: z.object({ orderId: z.string() }),
});

const ClaimQuota = makeRequest({
  name: 'emit.quotas.claim',
  input: z.object({ tenantId: z.string() }),
  output: z.object({ granted: z.number() }),
});

/** Что увидели обработчики этой сборки */
let placed: string[] = [];
let archived: string[] = [];
let billed: string[] = [];
let keys: unknown[] = [];

/** Пайплайн владельца команды: наблюдение за транспортными атрибутами кадра */
const commandPipeline = () =>
  makePipeline().pre(async (ctx) => {
    keys.push(ctx.raw.attributes.idempotencyKey);

    return {};
  });

const OrdersModule = makeFeature({
  name: 'module:orders',
  endpoints: [
    implement(PlaceOrder, {
      pipeline: commandPipeline(),
      handle: async (input) => {
        placed.push(input.orderId);

        return undefined;
      },
    }),
    implement(OrderPlaced, {
      subscriber: 'archive',
      handle: async (input) => {
        archived.push(input.orderId);

        return undefined;
      },
    }),
    implement(OrderPlaced, {
      subscriber: 'billing',
      handle: async (input) => {
        billed.push(input.orderId);

        return undefined;
      },
    }),
  ],
});

describe('app.emit', () => {
  beforeEach(() => {
    placed = [];
    archived = [];
    billed = [];
    keys = [];
  });

  it('доставляет факт обоим подписчикам и называет каждого', async () => {
    await using app = await assembleTest({ features: [OrdersModule] });

    const deliveries = await app.emit(OrderPlaced, {
      orderId: 'o-1',
      tenantId: 't1',
    });

    expect(archived).toEqual(['o-1']);
    expect(billed).toEqual(['o-1']);
    expect(deliveries.map(({ subscriber }) => subscriber).sort()).toEqual([
      'archive',
      'billing',
    ]);
    expect(deliveries.every(({ response }) => response.isSuccess)).toBe(true);
  });

  it('доставляет команду единственному владельцу', async () => {
    await using app = await assembleTest({ features: [OrdersModule] });

    const deliveries = await app.emit(PlaceOrder, { orderId: 'o-2' });

    expect(placed).toEqual(['o-2']);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].subscriber).toBe('emit.orders.place');
  });

  it('чеканит idempotencyKey команды и показывает его обработчику', async () => {
    await using app = await assembleTest({ features: [OrdersModule] });

    await app.emit(PlaceOrder, { orderId: 'o-3' });
    await app.emit(PlaceOrder, { orderId: 'o-4' }, { idempotencyKey: 'k1' });

    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe('k1');
  });

  it('гонит запрос через полный пайплайн реализации', async () => {
    await using app = await assembleTest({ features: [OrdersModule] });

    // Невалидный payload разбирается проверкой границы того же endpoint'а,
    // а не теряется по дороге: кадр запроса собран той же процедурой, что
    // у call
    const [{ response }] = await app.emit(PlaceOrder, {
      orderId: 42,
    } as unknown as { orderId: string });

    expect(response).toMatchObject({
      isSuccess: false,
      value: { code: 'VALIDATION_FAILED' },
    });
  });

  it('возвращает пустой список у события без подписчиков', async () => {
    await using app = await assembleTest({ features: [OrdersModule] });

    await expect(app.emit(Forgotten, { orderId: 'o-5' })).resolves.toEqual([]);
  });

  it('бросает у команды без владельца, перечисляя доступные subject`ы', async () => {
    await using app = await assembleTest({ features: [OrdersModule] });

    await expect(app.emit(Unowned, { orderId: 'o-6' })).rejects.toThrow(
      /'emit\.orders\.unowned'.*no owner.*emit\.orders\.place, emit\.orders\.placed/s,
    );
  });

  it('бросает с понятным сообщением на операцию-запросе', async () => {
    await using app = await assembleTest({ features: [OrdersModule] });

    await expect(
      app.emit(ClaimQuota as unknown as typeof PlaceOrder, { orderId: 'o-7' }),
    ).rejects.toThrow(/is a 'request' contract.*app\.call/s);
  });

  it('доставляет подписчикам, даже когда эмиттер того же операции застабан', async () => {
    await using app = await assembleTest({
      features: [OrdersModule],
      stubs: [stub(OrderPlaced, () => undefined)],
    });

    const deliveries = await app.emit(OrderPlaced, {
      orderId: 'o-8',
      tenantId: 't1',
    });

    // Стаб заменяет то, что приложение зовёт наружу; `emit` драйвит его
    // снаружи внутрь — одно другое не отменяет
    expect(deliveries).toHaveLength(2);
    expect(archived).toEqual(['o-8']);
    expect(app.stubbed).toEqual(['emit.orders.placed']);
  });
});
