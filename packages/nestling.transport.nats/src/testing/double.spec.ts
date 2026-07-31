/**
 * Двойник обязан вести себя как брокер **в тех местах, на которые
 * опирается транспорт**: queue-группы, копии разным группам, wildcard,
 * req-reply и отказ «никто не слушает», headers и durable-доставка.
 *
 * Всё, чего в этом списке нет, двойник не моделирует сознательно — и это
 * ровно та граница, за которой отвечает интеграционный прогон.
 */

import {
  NATS_NO_RESPONDERS,
  NatsDouble,
  NatsDoubleError,
  subjectMatches,
} from './double.js';

import { describe, expect, it } from '@jest/globals';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytes = (value: string): Uint8Array => encoder.encode(value);
const text = (value: Uint8Array): string => decoder.decode(value);

/** Даёт доставке провернуться */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('subjectMatches', () => {
  it.each([
    ['orders.placed', 'orders.placed', true],
    ['orders.*', 'orders.placed', true],
    ['orders.*', 'orders.placed.v2', false],
    ['orders.>', 'orders.placed.v2', true],
    ['orders.>', 'orders', false],
    ['orders.placed', 'orders.shipped', false],
  ])('%s ~ %s → %s', (pattern, subject, expected) => {
    expect(subjectMatches(pattern, subject)).toBe(expected);
  });
});

describe('двойник брокера — core', () => {
  it('члены одной группы делят сообщение', async () => {
    const broker = new NatsDouble();
    const seen: string[] = [];

    for (const replica of ['a', 'b']) {
      broker.subscribe('orders.ship', {
        queue: 'owner:orders.ship',
        callback: () => seen.push(replica),
      });
    }

    broker.publish('orders.ship', bytes('{}'));
    broker.publish('orders.ship', bytes('{}'));
    await settle();

    expect(seen).toHaveLength(2);
    expect(new Set(seen)).toEqual(new Set(['a', 'b']));
  });

  it('разные группы получают по копии', async () => {
    const broker = new NatsDouble();
    const seen: string[] = [];

    for (const subscriber of ['billing', 'analytics']) {
      broker.subscribe('orders.placed', {
        queue: subscriber,
        callback: () => seen.push(subscriber),
      });
    }

    broker.publish('orders.placed', bytes('{}'));
    await settle();

    expect(seen.sort()).toEqual(['analytics', 'billing']);
  });

  it('wildcard-подписка получает сообщения поддерева', async () => {
    const broker = new NatsDouble();
    const seen: string[] = [];

    broker.subscribe('orders.>', {
      queue: 'audit',
      callback: (_error, msg) => seen.push(msg.subject),
    });

    broker.publish('orders.placed', bytes('{}'));
    broker.publish('orders.shipped', bytes('{}'));
    broker.publish('billing.charged', bytes('{}'));
    await settle();

    expect(seen).toEqual(['orders.placed', 'orders.shipped']);
  });

  it('req-reply возвращает ответ отвечающего вместе с headers запроса', async () => {
    const broker = new NatsDouble();

    broker.subscribe('billing.charge', {
      queue: 'owner:billing.charge',
      callback: (_error, msg) => {
        msg.respond(bytes(`${text(msg.data)}|${msg.headers?.get('Nl-Test')}`));
      },
    });

    const headers = broker.headers();
    headers.set('Nl-Test', 'yes');

    const reply = await broker.request('billing.charge', bytes('ping'), {
      timeout: 100,
      headers,
    });

    expect(text(reply.data)).toBe('ping|yes');
  });

  it('запрос без подписчиков отвечает кодом 503', async () => {
    const broker = new NatsDouble();

    await expect(
      broker.request('billing.charge', bytes('{}'), { timeout: 50 }),
    ).rejects.toMatchObject({ code: NATS_NO_RESPONDERS });
  });

  it('запрос без ответа истекает по таймауту', async () => {
    const broker = new NatsDouble();

    broker.subscribe('billing.silent', {
      queue: 'owner',
      callback: () => {
        /* отвечать не собирается */
      },
    });

    await expect(
      broker.request('billing.silent', bytes('{}'), { timeout: 20 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('дренаж соединения не закрывает брокер остальным', async () => {
    const broker = new NatsDouble();
    const first = broker.connection();
    const second = broker.connection();

    const seen: string[] = [];
    second.subscribe('orders.placed', {
      queue: 'billing',
      callback: (_error, msg) => seen.push(text(msg.data)),
    });

    await first.drain();

    // Своё соединение закрыто — глаголы отказывают
    expect(() => first.publish('orders.placed', bytes('o-1'))).toThrow(
      NatsDoubleError,
    );

    // Брокер и чужие подписки живы
    second.publish('orders.placed', bytes('o-2'));
    await settle();

    expect(seen).toEqual(['o-2']);
  });
});

/** Поток и durable-потребитель под ним */
const prepare = async (broker: NatsDouble, durable: string): Promise<void> => {
  const manager = await broker.jetstreamManager();

  await manager.streams.add({
    name: 'nestling_orders_placed',
    subjects: ['orders.placed'],
  });
  await manager.consumers.add('nestling_orders_placed', {
    durable_name: durable,
    ack_policy: 'explicit',
    filter_subject: 'orders.placed',
  });
};

describe('двойник брокера — JetStream', () => {
  it('сообщение переживает простой подписчика', async () => {
    const broker = new NatsDouble();
    await prepare(broker, 'billing');

    // Подписчик ещё не поднялся, а факт уже опубликован
    await broker.jetstream().publish('orders.placed', bytes('o-1'));

    const messages = await broker.jetstream().subscribe('orders.placed', {
      stream: 'nestling_orders_placed',
      durable: 'billing',
    });

    for await (const msg of messages) {
      expect(text(msg.data)).toBe('o-1');
      msg.ack();
      break;
    }
  });

  it('nak возвращает сообщение в поток, ack — нет', async () => {
    const broker = new NatsDouble();
    await prepare(broker, 'billing');

    await broker.jetstream().publish('orders.placed', bytes('o-1'));

    const messages = await broker.jetstream().subscribe('orders.placed', {
      stream: 'nestling_orders_placed',
      durable: 'billing',
    });

    const attempts: number[] = [];

    for await (const msg of messages) {
      attempts.push(msg.redeliveryCount);

      if (msg.redeliveryCount === 1) {
        msg.nak();
        continue;
      }

      msg.ack();
      break;
    }

    expect(attempts).toEqual([1, 2]);
  });

  it('публикация в subject без потока отказывает', async () => {
    const broker = new NatsDouble();

    await expect(
      broker.jetstream().publish('orders.unknown', bytes('{}')),
    ).rejects.toThrow(/no stream matches subject/);
  });
});
