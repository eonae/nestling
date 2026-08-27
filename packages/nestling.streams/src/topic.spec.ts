import { Topic } from './topic.js';

/** Отдаёт управление циклу событий: даёт подписке дойти до `await next()` */
const tick = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('Topic', () => {
  it('публикует без подписчиков и ничего не копит', async () => {
    const topic = new Topic<number>();

    expect(topic.subscribers).toBe(0);
    expect(() => topic.push(1)).not.toThrow();

    const subscription = topic.subscribe();
    const next = subscription.next();
    topic.push(2);

    await expect(next).resolves.toEqual({ value: 2, done: false });
  });

  it('доставляет событие всем подписчикам', async () => {
    const topic = new Topic<string>();
    const a = topic.subscribe();
    const b = topic.subscribe();

    const pending = Promise.all([a.next(), b.next()]);
    topic.push('hello');

    expect(await pending).toEqual([
      { value: 'hello', done: false },
      { value: 'hello', done: false },
    ]);
    expect(topic.subscribers).toBe(2);
  });

  it('медленный подписчик не тормозит остальных, push не ждёт', async () => {
    const topic = new Topic<number>({ buffer: 2 });

    // Медленный: подписался, но не читает
    const slow = topic.subscribe();
    const fast = topic.subscribe();

    const received: number[] = [];
    const reader = (async () => {
      for await (const value of fast) {
        received.push(value);
        if (received.length === 4) {
          break;
        }
      }
    })();

    for (let i = 1; i <= 4; i++) {
      topic.push(i);
      await tick();
    }

    await reader;

    expect(received).toEqual([1, 2, 3, 4]);
    // Буфер медленного переполнялся — старые события отброшены
    expect(topic.dropped).toBeGreaterThan(0);

    await slow.return?.();
  });

  it('политика drop-oldest отбрасывает самое старое и продолжает', async () => {
    const topic = new Topic<number>({ buffer: 2 });
    const subscription = topic.subscribe();

    for (const value of [1, 2, 3]) {
      topic.push(value);
    }

    expect(topic.dropped).toBe(1);
    expect(topic.subscribers).toBe(1);

    await expect(subscription.next()).resolves.toEqual({
      value: 2,
      done: false,
    });
    await expect(subscription.next()).resolves.toEqual({
      value: 3,
      done: false,
    });
  });

  it('политика disconnect завершает переполнившуюся подписку, остальные живут', async () => {
    const topic = new Topic<number>({
      buffer: 2,
      onSlowConsumer: 'disconnect',
    });

    const overflowing = topic.subscribe();
    const healthy = topic.subscribe();

    // healthy читает по мере поступления, overflowing — нет
    const healthyItems: number[] = [];
    const reader = (async () => {
      for await (const value of healthy) {
        healthyItems.push(value);
        if (healthyItems.length === 3) {
          break;
        }
      }
    })();

    topic.push(1);
    await tick();
    topic.push(2);
    await tick();
    topic.push(3);
    await tick();

    await reader;

    // Первая подписка переполнилась (буфер 2, три события) и завершена
    await expect(overflowing.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });
    expect(healthyItems).toEqual([1, 2, 3]);
  });

  it('close() завершает все подписки нормально', async () => {
    const topic = new Topic<number>();
    const subscriptions = [
      topic.subscribe(),
      topic.subscribe(),
      topic.subscribe(),
    ];

    const pending = Promise.all(subscriptions.map((it) => it.next()));
    topic.close();

    expect(await pending).toEqual([
      { value: undefined, done: true },
      { value: undefined, done: true },
      { value: undefined, done: true },
    ]);
    expect(topic.subscribers).toBe(0);
    expect(topic.closed).toBe(true);
  });

  it('подписка завершается по сигналу', async () => {
    const topic = new Topic<number>();
    const controller = new AbortController();
    const subscription = topic.subscribe(controller.signal);

    const next = subscription.next();
    controller.abort();

    await expect(next).resolves.toEqual({ value: undefined, done: true });
  });

  it('выход из цикла снимает подписку', async () => {
    const topic = new Topic<number>();

    const reader = (async () => {
      for await (const value of topic.subscribe()) {
        if (value === 1) {
          break;
        }
      }
    })();

    await tick();
    expect(topic.subscribers).toBe(1);

    topic.push(1);
    await reader;

    expect(topic.subscribers).toBe(0);
  });

  it('1 000 циклов «подписался — отписался» не накапливают подписки', async () => {
    const topic = new Topic<number>();

    for (let i = 0; i < 1000; i++) {
      const subscription = topic.subscribe();
      const next = subscription.next();
      topic.push(i);
      await next;
      await subscription.return?.();
    }

    expect(topic.subscribers).toBe(0);
  });
});
