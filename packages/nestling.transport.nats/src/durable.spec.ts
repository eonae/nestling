/* eslint-disable unicorn/no-useless-undefined --
 * Реализация контракта без `output` возвращает `undefined` явно: так
 * записан контракт хендлера в ядре (`Output<undefined>`). */
/**
 * Долговечная доставка: поток, durable-потребитель и правило
 * «ack по факту решения, повтор по факту отсутствия решения».
 *
 * Всё — против двойника брокера: сеть здесь не нужна ни в одном сценарии.
 */

import { NatsDouble as Broker, natsDouble } from './testing/double.js';
import { NatsBus } from './transport.js';

import { describe, expect, it } from '@jest/globals';
import { makeContract } from '@nestling/contracts';
import { defineFail, makePipeline } from '@nestling/pipeline';
import { implement } from '@nestling/ports';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

const Rejected = defineFail('ORDER_REJECTED', {
  status: 'CONFLICT',
  message: 'Order rejected',
});

const Placed = makeContract({
  name: 'durable.orders.placed',
  kind: 'event',
  durable: true,
  input: z.object({ orderId: z.string() }),
  errors: [Rejected],
});

let handled: string[] = [];
/** Что обработчик сделает на очередной доставке */
let behaviour: 'ok' | 'fail' | 'throw' = 'ok';

const makeSubscriber = (name: string) =>
  implement(Placed, {
    subscriber: name,
    pipeline: makePipeline().pre(() => undefined),
    handle: async (input) => {
      handled.push(`${name}:${input.orderId}`);

      if (behaviour === 'fail') {
        return Rejected();
      }

      if (behaviour === 'throw') {
        throw new Error('subscriber is broken');
      }

      return undefined;
    },
  });

const Billing = makeSubscriber('billing');
const Analytics = makeSubscriber('analytics');

const settle = async (ms = 5): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

/** Процесс на общем брокере */
async function process(
  broker: Broker,
  declarations: readonly Parameters<typeof makeDispatch>[0][number][],
): Promise<NatsBus> {
  const bus = new NatsBus({
    connect: natsDouble(broker),
    onDeliveryFailure: () => {
      /* повторы ожидаемы: тест смотрит на состав доставок */
    },
  });

  await bus.connect();
  await bus.serve(makeDispatch(declarations), new AbortController().signal);

  return bus;
}

describe('долговечная доставка', () => {
  beforeEach(() => {
    handled = [];
    behaviour = 'ok';
  });

  it('сообщение переживает простой подписчика', async () => {
    const broker = new Broker();

    // Издатель есть, подписчика ещё нет: факт обязан дождаться
    const publisher = await process(broker, []);
    await publisher.publish(
      'durable.orders.placed',
      { orderId: 'o-1' },
      { durable: true },
    );

    const subscriber = await process(broker, [Billing]);
    await settle();

    expect(handled).toEqual(['billing:o-1']);

    await publisher.close();
    await subscriber.close();
  });

  it('emit резолвится по факту сохранения, а не постановки', async () => {
    const broker = new Broker();
    const publisher = await process(broker, []);

    await publisher.publish(
      'durable.orders.placed',
      { orderId: 'o-1' },
      { durable: true },
    );

    // Поток создан и запись в нём: подписчик, поднявшийся позже, её увидит
    const manager = await broker.jetstreamManager();
    await expect(
      manager.streams.info('nestling_durable_orders_placed'),
    ).resolves.toMatchObject({
      config: { subjects: ['durable.orders.placed'] },
    });

    await publisher.close();
  });

  it('реплики подписчика делят поток', async () => {
    const broker = new Broker();
    const replicas = await Promise.all([
      process(broker, [Billing]),
      process(broker, [Billing]),
    ]);
    const publisher = await process(broker, []);

    await publisher.publish(
      'durable.orders.placed',
      { orderId: 'o-1' },
      { durable: true },
    );
    await settle(20);

    expect(handled).toEqual(['billing:o-1']);

    for (const replica of replicas) {
      await replica.close();
    }
    await publisher.close();
  });

  it('разные подписчики читают поток независимо', async () => {
    const broker = new Broker();
    const processes = await Promise.all([
      process(broker, [Billing]),
      process(broker, [Analytics]),
    ]);
    const publisher = await process(broker, []);

    await publisher.publish(
      'durable.orders.placed',
      { orderId: 'o-1' },
      { durable: true },
    );
    await settle(20);

    expect(handled.sort()).toEqual(['analytics:o-1', 'billing:o-1']);

    for (const item of processes) {
      await item.close();
    }
    await publisher.close();
  });

  it('задекларированный отказ подтверждается и не повторяется', async () => {
    const broker = new Broker();
    behaviour = 'fail';

    const subscriber = await process(broker, [Billing]);
    const publisher = await process(broker, []);

    await publisher.publish(
      'durable.orders.placed',
      { orderId: 'o-1' },
      { durable: true },
    );
    await settle(30);

    // Ровно одна доставка: обработка завершилась решением, и повторять его
    // бессмысленно — второй раз обработчик решит то же самое
    expect(handled).toEqual(['billing:o-1']);

    await subscriber.close();
    await publisher.close();
  });

  it('необработанное исключение возвращает сообщение в поток', async () => {
    const broker = new Broker();
    behaviour = 'throw';

    const subscriber = await process(broker, [Billing]);
    const publisher = await process(broker, []);

    await publisher.publish(
      'durable.orders.placed',
      { orderId: 'o-1' },
      { durable: true },
    );
    await settle(30);

    // Решения не получилось — сообщение доставляется снова
    expect(handled.length).toBeGreaterThan(1);

    await subscriber.close();
    await publisher.close();
  });

  it('исчерпание попыток снимает доставку и отчитывается хуку', async () => {
    const broker = new Broker();
    behaviour = 'throw';

    const terminated: string[] = [];
    const subscriber = new NatsBus({
      connect: natsDouble(broker),
      maxDeliver: 2,
      onDeliveryFailure: (info) => {
        if (info.terminated) {
          terminated.push(info.subject);
        }
      },
    });

    await subscriber.connect();
    await subscriber.serve(
      makeDispatch([Billing]),
      new AbortController().signal,
    );

    const publisher = await process(broker, []);
    await publisher.publish(
      'durable.orders.placed',
      { orderId: 'o-1' },
      { durable: true },
    );
    await settle(30);

    expect(handled).toHaveLength(2);
    expect(terminated).toEqual(['durable.orders.placed']);

    await subscriber.close();
    await publisher.close();
  });

  it('конфликт определения потока падает с понятным сообщением', async () => {
    const broker = new Broker();
    const manager = await broker.jetstreamManager();

    // Поток с тем же именем уже существует и покрывает другой subject
    await manager.streams.add({
      name: 'nestling_durable_orders_placed',
      subjects: ['legacy.orders.placed'],
    });

    const bus = new NatsBus({ connect: natsDouble(broker) });
    await bus.connect();

    await expect(
      bus.serve(makeDispatch([Billing]), new AbortController().signal),
    ).rejects.toThrow(
      /stream 'nestling_durable_orders_placed'.*does not cover subject/s,
    );

    await bus.close();
  });
});
