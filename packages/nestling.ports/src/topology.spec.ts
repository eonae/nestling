/* eslint-disable unicorn/no-useless-undefined --
 * Реализация контракта без `output` возвращает `undefined` явно: так
 * записан контракт хендлера в ядре (`Output<undefined>`), и `() => {}`
 * ему не соответствует. */
import { httpLikeDeclaration } from './__test-helpers__/foreign-declaration.js';
import { makeContract } from './contract.js';
import { implement } from './implement.js';
import { collectImplementations } from './topology.js';

import { Ok } from '@nestling/pipeline';
import { z } from 'zod';

const ChargeCard = makeContract({
  name: 'topology.billing.charge',
  kind: 'request',
  input: z.object({ amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
});

const OrderPlaced = makeContract({
  name: 'topology.orders.placed',
  kind: 'event',
  input: z.object({ orderId: z.string() }),
});

const chargeImpl = implement(ChargeCard, {
  handle: async () => new Ok({ chargeId: 'c-1' }),
});

const billingSubscriber = implement(OrderPlaced, {
  subscriber: 'billing',
  handle: async () => undefined,
});

const analyticsSubscriber = implement(OrderPlaced, {
  subscriber: 'analytics',
  handle: async () => undefined,
});

describe('collectImplementations', () => {
  it('собирает топологию «subject → вид, подписчики, модули»', () => {
    const topology = collectImplementations([
      { endpoint: chargeImpl, moduleName: 'module:billing' },
      { endpoint: billingSubscriber, moduleName: 'module:billing' },
      { endpoint: analyticsSubscriber, moduleName: 'module:analytics' },
    ]);

    expect(topology.get('topology.billing.charge')).toEqual({
      subject: 'topology.billing.charge',
      kind: 'request',
      implementations: [
        { pattern: 'topology.billing.charge', moduleName: 'module:billing' },
      ],
    });

    expect(topology.get('topology.orders.placed')?.implementations).toEqual([
      {
        pattern: 'topology.orders.placed@billing',
        subscriber: 'billing',
        moduleName: 'module:billing',
      },
      {
        pattern: 'topology.orders.placed@analytics',
        subscriber: 'analytics',
        moduleName: 'module:analytics',
      },
    ]);
  });

  it('игнорирует декларации чужих транспортов', () => {
    const topology = collectImplementations([
      { endpoint: httpLikeDeclaration, moduleName: 'module:users' },
    ]);

    expect(topology.size).toBe(0);
  });

  it('отвергает двух владельцев запроса, называя оба модуля', () => {
    const second = implement(ChargeCard, {
      handle: async () => new Ok({ chargeId: 'c-2' }),
    });

    expect(() =>
      collectImplementations([
        { endpoint: chargeImpl, moduleName: 'module:billing' },
        { endpoint: second, moduleName: 'module:payments' },
      ]),
    ).toThrow(/module 'module:billing' and in module 'module:payments'/);
  });

  it('отвергает двух подписчиков события с одним именем', () => {
    const twin = implement(OrderPlaced, {
      subscriber: 'billing',
      handle: async () => undefined,
    });

    expect(() =>
      collectImplementations([
        { endpoint: billingSubscriber, moduleName: 'module:billing' },
        { endpoint: twin, moduleName: 'module:legacy-billing' },
      ]),
    ).toThrow(/two subscribers named 'billing'/);
  });
});
