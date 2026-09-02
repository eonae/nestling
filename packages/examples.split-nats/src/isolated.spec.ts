/**
 * Предмет проверки — вторая половина тезиса `composition.md`: фича
 * тестируется **без соседей и без брокера**.
 *
 * Здесь ни одного `NatsDouble` и ни одного второго процесса. Собирается
 * ровно `select: 'orders'`, владелец `quotas.claim` подменён контрактным
 * стабом, а внешний издатель — это `app.emit`. Код фичи тот же самый, что в
 * `split.spec.ts`: между «двумя процессами через брокер» и «одной фичей в
 * тесте» не меняется ни одна декларация.
 */

/* eslint-disable unicorn/no-useless-undefined --
 * Фейк `event`-контракта возвращает `undefined` явно: так записан контракт
 * его реализации (`void | Promise<void>`). */

import { TenantId } from './context';
import {
  ClaimQuota,
  OrderPlaced,
  PlaceOrder,
  QuotaExceeded,
} from './contracts';
import { OrdersFeature } from './orders';
import { QuotasFeature } from './quotas';

import { describe, expect, it } from '@jest/globals';
import {
  assembleTest,
  checkTopologies,
  contextValue,
  stub,
} from '@nestling/testing';
import { nats } from '@nestling/transport.nats';

/** Честный словарь сборки — тот же, что и в проде (см. `root.ts`) */
const honestSpec = {
  features: [OrdersFeature, QuotasFeature],
  transports: [nats({ name: 'events' })],
  intercom: 'events',
};

describe('фича в изоляции: без соседа и без брокера', () => {
  it('процесс-потребитель запускается через app.emit и доходит до факта', async () => {
    const claimed: { tenantId: string; amount: number }[] = [];
    const placed: { orderId: string; tenantId: string }[] = [];

    await using app = await assembleTest({
      features: [OrdersFeature, QuotasFeature],
      select: 'orders',
      // Ни владельца `quotas.claim`, ни подписчика `orders.placed` в этой
      // сборке нет — и это не мешает: обе стороны поставлены стабами
      stubs: [
        stub(ClaimQuota, async (input) => {
          claimed.push(input);

          return { granted: input.amount };
        }),
        stub(OrderPlaced, (input) => {
          placed.push(input);
        }),
      ],
      // Арендатор в бою приходит конвертом с шины; здесь его объявляет тест
      overrides: [contextValue(TenantId, 'acme')],
    });

    const [{ subscriber, response }] = await app.emit(PlaceOrder, {
      orderId: 'o-1',
      amount: 10,
    });

    expect(subscriber).toBe('orders.place');
    expect(response.isSuccess).toBe(true);
    expect(claimed).toEqual([{ tenantId: 'acme', amount: 10 }]);
    expect(placed).toEqual([{ orderId: 'o-1', tenantId: 'acme' }]);
  });

  it('исчерпанная квота останавливает процесс до факта', async () => {
    const placed: unknown[] = [];

    await using app = await assembleTest({
      features: [OrdersFeature, QuotasFeature],
      select: 'orders',
      stubs: [
        // Отказ объявлен в `errors:` контракта, поэтому передаётся как есть —
        // ровно так же, как пришёл бы по сети от настоящего владельца
        stub(ClaimQuota, async ({ tenantId }) => QuotaExceeded({ tenantId })),
        stub(OrderPlaced, (input) => {
          placed.push(input);
        }),
      ],
      overrides: [contextValue(TenantId, 'acme')],
    });

    await app.emit(PlaceOrder, { orderId: 'o-2', amount: 10 });

    expect(placed).toEqual([]);
  });

  it('каждый застабанный контракт опубликован честной топологией', async () => {
    await using app = await assembleTest({
      features: [OrdersFeature, QuotasFeature],
      select: 'orders',
      stubs: [
        stub(ClaimQuota, async () => ({ granted: 1 })),
        stub(OrderPlaced, () => undefined),
      ],
      overrides: [contextValue(TenantId, 'acme')],
    });

    // Матрица гоняет **честный** граф: подстановок `.check()` не принимает,
    // и именно этим компенсируются стабы теста
    const topologies = await checkTopologies(honestSpec, [
      'all',
      'orders',
      'quotas',
    ]);

    const published = new Set(
      topologies.flatMap(({ report }) =>
        report.contracts.map(({ name }) => name),
      ),
    );

    // Стаб, прикрывший контракт, которого не реализует ни одна топология,
    // стал бы виден здесь — это и есть машинная форма правила «мокаешь —
    // проверь топологию»
    expect(app.stubbed.filter((name) => !published.has(name))).toEqual([]);
    expect(app.stubbed).toEqual(['orders.placed', 'quotas.claim']);
  });
});
