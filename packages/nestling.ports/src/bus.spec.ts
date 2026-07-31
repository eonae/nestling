import { InProcessBus } from './bus.js';
import { makeContract } from './contract.js';
import { implement } from './implement.js';

import { Ok, stream } from '@nestling/pipeline';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

/** Даёт насосам доставки провернуться */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('InProcessBus', () => {
  it('доставляет команду ровно одному члену группы', async () => {
    const bus = new InProcessBus();
    const seen: string[] = [];

    bus.subscribe('bus.command', () => void seen.push('a'), { group: 'owner' });
    bus.subscribe('bus.command', () => void seen.push('b'), { group: 'owner' });

    await bus.publish('bus.command', { id: 1 });
    await settle();

    expect(seen).toHaveLength(1);

    await bus.close();
  });

  it('доставляет событие всем подписчикам', async () => {
    const bus = new InProcessBus();
    const seen: string[] = [];

    bus.subscribe('bus.event', () => void seen.push('billing'), {
      group: 'billing',
    });
    bus.subscribe('bus.event', () => void seen.push('analytics'), {
      group: 'analytics',
    });

    await bus.publish('bus.event', { id: 1 });
    await settle();

    expect(seen.sort()).toEqual(['analytics', 'billing']);

    await bus.close();
  });

  it('изолирует отказ подписчика и отдаёт его диагностическому хуку', async () => {
    const failures: string[] = [];
    const bus = new InProcessBus({
      onDeliveryFailure: ({ subject }) => failures.push(subject),
    });

    const seen: string[] = [];
    bus.subscribe(
      'bus.isolation',
      () => {
        throw new Error('subscriber is broken');
      },
      { group: 'broken' },
    );
    bus.subscribe('bus.isolation', () => void seen.push('healthy'), {
      group: 'healthy',
    });

    await bus.publish('bus.isolation', { id: 1 });
    await settle();

    expect(seen).toEqual(['healthy']);
    expect(failures).toEqual(['bus.isolation']);

    await bus.close();
  });

  it('после закрытия не доставляет ничего', async () => {
    const bus = new InProcessBus({
      onDeliveryFailure: () => {
        /* доставка молчит: тест смотрит на другое */
      },
    });
    const seen: unknown[] = [];

    bus.subscribe('bus.closed', (payload) => void seen.push(payload), {
      group: 'owner',
    });

    await bus.close();
    await bus.publish('bus.closed', { id: 1 });
    await settle();

    expect(seen).toEqual([]);

    const response = await bus.request('bus.closed', { id: 1 });
    expect(response.isSuccess).toBe(false);
  });

  it('не ждёт медленного подписчика на публикации', async () => {
    const bus = new InProcessBus();
    let started = false;

    bus.subscribe(
      'bus.slow',
      async () => {
        started = true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
      { group: 'slow' },
    );

    const before = Date.now();
    await bus.publish('bus.slow', { id: 1 });
    const elapsed = Date.now() - before;

    expect(elapsed).toBeLessThan(40);
    expect(started).toBe(false);

    await settle();
    expect(started).toBe(true);

    await bus.close();
  });

  it('req-reply идёт через async-барьер и структурную копию', async () => {
    const bus = new InProcessBus();
    let receivedSynchronously = true;
    let received: { items: number[] } | undefined;

    bus.subscribe(
      'bus.request',
      (payload) => {
        received = payload as { items: number[] };

        return {
          isSuccess: true,
          status: 'OK',
          value: { echo: true },
        } as const;
      },
      { group: 'owner' },
    );

    const payload = { items: [1, 2] };
    const pending = bus.request('bus.request', payload);
    receivedSynchronously = received !== undefined;

    const response = await pending;

    expect(receivedSynchronously).toBe(false);
    expect(response).toEqual({
      isSuccess: true,
      status: 'OK',
      value: { echo: true },
    });

    // Копия, а не ссылка: мутация у отправителя получателя не касается
    payload.items.push(3);
    expect(received?.items).toEqual([1, 2]);

    await bus.close();
  });

  it('отвергает несериализуемый payload, называя поле', async () => {
    const bus = new InProcessBus();

    await expect(
      bus.request('bus.unserializable', {
        onDone: (): void => undefined,
      }),
    ).rejects.toThrow(/field 'onDone' cannot be structurally cloned/);

    await bus.close();
  });

  it('запросу без подписчика отвечает отказом', async () => {
    const bus = new InProcessBus({
      onDeliveryFailure: () => {
        /* доставка молчит: тест смотрит на другое */
      },
    });

    const response = await bus.request('bus.orphan', {});

    expect(response.isSuccess).toBe(false);

    await bus.close();
  });

  it('в эфире подписывается на subject-ы своих маршрутов', async () => {
    const Ping = makeContract({
      name: 'bus.serve.ping',
      kind: 'request',
      input: z.object({ value: z.number() }),
      output: z.object({ doubled: z.number() }),
    });

    const declaration = implement(Ping, {
      handle: async (input) => new Ok({ doubled: input.value * 2 }),
    });

    const bus = new InProcessBus();
    const controller = new AbortController();

    await bus.serve(makeDispatch([declaration]), controller.signal);

    const response = await bus.request('bus.serve.ping', { value: 21 });

    expect(response).toMatchObject({ isSuccess: true, value: { doubled: 42 } });

    await bus.close();
  });

  it('отвергает потоковую форму существующей проверкой способностей', async () => {
    const Feed = makeContract({
      name: 'bus.serve.feed',
      kind: 'request',
      output: stream(z.object({ chunk: z.string() })),
    });

    const declaration = implement(Feed, {
      handle: async function* () {
        yield { chunk: 'a' };
      } as never,
    });

    const bus = new InProcessBus();

    await expect(
      bus.serve(makeDispatch([declaration]), new AbortController().signal),
    ).rejects.toThrow(/does not support form 'stream' in 'output'/);

    await bus.close();
  });
});
