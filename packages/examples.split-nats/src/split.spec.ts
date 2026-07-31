/**
 * Предмет проверки — тезис `composition.md`: **код фич между L3 и L4 не
 * меняется**.
 *
 * Оба теста поднимают одни и те же декларации одним и тем же корнем.
 * Отличается ровно `select`: в одном случае обе фичи в одном процессе, в
 * другом — в двух. Ни одна декларация `implement(...)` и ни один call-site
 * между ними не различаются.
 */

import { makeRoot } from './root';

import { describe, expect, it } from '@jest/globals';
import type { App } from '@nestling/app';
import { NatsBus } from '@nestling/transport.nats';
import { NatsDouble, natsDouble } from '@nestling/transport.nats/testing';

/** Провезённый арендатор из конверта отправленного сообщения */
function tenantOf(broker: NatsDouble, subject: string): unknown {
  const sent = broker.published.find((item) => item.subject === subject);
  const context = sent?.headers?.get('Nl-Ctx');

  return context
    ? (JSON.parse(context) as { tenantId?: string }).tenantId
    : undefined;
}

/** Даёт доставке провернуться */
const settle = async (ms = 30): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

/** Внешний драйвер: тот, кто кладёт команду на шину */
async function driver(broker: NatsDouble): Promise<NatsBus> {
  const bus = new NatsBus({ connect: natsDouble(broker) });
  await bus.connect();

  return bus;
}

/** Все процессы топологии — поднимаются и гасятся вместе */
async function run(
  broker: NatsDouble,
  ...selects: string[]
): Promise<{ close: () => Promise<void> }> {
  const apps: App[] = selects.map((select) =>
    makeRoot(select, { connect: natsDouble(broker) }),
  );

  for (const app of apps) {
    await app.run();
  }

  return {
    close: async () => {
      for (const app of apps.reverse()) {
        await app.close();
      }
    },
  };
}

describe('split-развёртывание через NATS', () => {
  it('L4: две половины в разных процессах общаются контрактами', async () => {
    const broker = new NatsDouble();
    // Владелец поднимается первым: у брокера нет очереди ожидания для
    // req-reply, и вызов к невыбранной нигде фиче — обычный отказ доставки
    const topology = await run(broker, 'quotas', 'orders');
    const outside = await driver(broker);

    await outside.publish(
      'orders.place',
      { orderId: 'o-1', amount: 10 },
      { context: { tenantId: 'acme' } },
    );
    await settle(60);

    // Вызов ушёл на брокер, а не упал на ASSEMBLE: владельца `quotas.claim`
    // в этой сборке нет, и раньше это была ошибка компоновки
    expect(broker.published.map(({ subject }) => subject)).toEqual(
      expect.arrayContaining(['orders.place', 'quotas.claim', 'orders.placed']),
    );

    // Провозимый арендатор доехал до **следующего** hop'а: процесс заказов
    // спроецировал его штатным `propagated()`, а вызыватель собрал из
    // ячейки этого запроса и положил в конверт сам
    expect(tenantOf(broker, 'quotas.claim')).toBe('acme');
    expect(tenantOf(broker, 'orders.placed')).toBe('acme');

    // Событие объявлено долговечным — значит под ним поток, и подписчик,
    // поднявшийся позже, факта не потеряет
    const manager = await broker.jetstreamManager();
    await expect(
      manager.streams.info('nestling_orders_placed'),
    ).resolves.toMatchObject({ config: { subjects: ['orders.placed'] } });

    await outside.close();
    await topology.close();
  });

  it('L3: те же декларации одним процессом', async () => {
    const broker = new NatsDouble();
    const topology = await run(broker, 'all');
    const outside = await driver(broker);

    await outside.publish(
      'orders.place',
      { orderId: 'o-2', amount: 10 },
      { context: { tenantId: 'acme' } },
    );
    await settle(60);

    expect(broker.published.map(({ subject }) => subject)).toEqual(
      expect.arrayContaining(['orders.place', 'orders.placed']),
    );

    await outside.close();
    await topology.close();
  });

  it('процесс-потребитель собирается без владельца контракта рядом', async () => {
    const broker = new NatsDouble();

    // Ни одной реализации `quotas.claim` в этой сборке нет — и это больше
    // не ошибка ASSEMBLE: шина доставляет за пределы процесса
    const topology = await run(broker, 'orders');

    await topology.close();
  });
});
