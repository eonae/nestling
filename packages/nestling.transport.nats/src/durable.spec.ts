/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`). */
/**
 * Долговечная доставка: поток, durable-потребитель и правило
 * «ack по факту решения, повтор по факту отсутствия решения».
 *
 * Всё — против двойника брокера: сеть здесь не нужна ни в одном сценарии.
 */

import { NatsDouble as Broker, natsDouble } from './testing/double.js';
import { NatsBus } from './transport.js';

import { describe, expect, it } from '@jest/globals';
import type { Fields, Logger, LogLevel } from '@nestlingjs/app';
import {
  implement,
  makeDispatch,
  makeFail,
  makePipeline,
} from '@nestlingjs/app';
import { makeCommand, makeEvent } from '@nestlingjs/operations';
import { z } from 'zod';

const Rejected = makeFail('conflict:order_rejected', {
  message: 'Order rejected',
});

const Placed = makeEvent({
  name: 'durable.orders.placed',
  durable: true,
  input: z.object({ orderId: z.string() }),
});

/**
 * Отказ объявляет команда, а не событие: отказ доставляется вызывающему,
 * а у события его нет. Долговечность у команды та же.
 */
const Charge = makeCommand({
  name: 'durable.orders.charge',
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
    handler: async (input) => {
      handled.push(`${name}:${input.orderId}`);

      if (behaviour === 'throw') {
        throw new Error('subscriber is broken');
      }

      return undefined;
    },
  });

/** Обработчик команды: он умеет ответить объявленным отказом */
const ChargeHandler = implement(Charge, {
  pipeline: makePipeline().pre(() => undefined),
  handler: async (input) => {
    handled.push(`charge:${input.orderId}`);

    return behaviour === 'fail' ? Rejected() : undefined;
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
  // Повторы ожидаемы: тест смотрит на состав доставок, записи копит шпион
  const bus = new NatsBus({
    connect: natsDouble(broker),
    logger: spyLogger().logger,
  });

  await bus.connect();
  await bus.serve(makeDispatch(declarations), new AbortController().signal);

  return bus;
}

/** Логгер-шпион: записи ядра копятся значениями, а не уходят в stderr */
function spyLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const make = (bindings: Fields): Logger => {
    const write =
      (level: LogLevel) =>
      (first: string | Error | Fields, second?: Fields): void => {
        if (typeof first === 'string') {
          entries.push({
            level,
            message: first,
            fields: { ...bindings, ...second },
          });
        } else if (first instanceof Error) {
          entries.push({
            level,
            message: first.message,
            fields: { ...bindings, ...second, err: first },
          });
        } else {
          entries.push({
            level,
            message: '',
            fields: { ...bindings, ...first },
          });
        }
      };

    return {
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
      child: (extra) => make({ ...bindings, ...extra }),
    };
  };

  return { logger: make({}), entries };
}

interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: Fields;
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

    const subscriber = await process(broker, [ChargeHandler]);
    const publisher = await process(broker, []);

    await publisher.publish(
      'durable.orders.charge',
      { orderId: 'o-1' },
      { durable: true },
    );
    await settle(30);

    // Ровно одна доставка: обработка завершилась решением, и повторять его
    // бессмысленно — второй раз обработчик решит то же самое
    expect(handled).toEqual(['charge:o-1']);

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

  it('исчерпание попыток снимает доставку и пишет об этом в логгер', async () => {
    const broker = new Broker();
    behaviour = 'throw';

    const spy = spyLogger();
    const subscriber = new NatsBus({
      connect: natsDouble(broker),
      maxDeliver: 2,
      logger: spy.logger,
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

    const terminated = spy.entries.filter(
      (entry) => entry.fields.terminated === true,
    );
    expect(terminated).toEqual([
      {
        level: 'error',
        message: 'nats delivery failed',
        fields: {
          subject: 'durable.orders.placed',
          terminated: true,
          err: expect.anything(),
        },
      },
    ]);

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

    const bus = new NatsBus({
      connect: natsDouble(broker),
      logger: spyLogger().logger,
    });
    await bus.connect();

    await expect(
      bus.serve(makeDispatch([Billing]), new AbortController().signal),
    ).rejects.toThrow(
      /stream 'nestling_durable_orders_placed'.*does not cover subject/s,
    );

    await bus.close();
  });
});
