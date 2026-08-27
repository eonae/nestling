/* eslint-disable unicorn/no-useless-undefined --
 * Реализация контракта без `output` возвращает `undefined` явно: так
 * записан контракт хендлера в ядре (`Output<undefined>`). */
/**
 * Пакет в собранном приложении: тестовый корень, полный пайплайн,
 * `await using` → SHUTDOWN.
 *
 * Здесь же проверяются два отрицательных утверждения, ради которых слой и
 * модуль сделаны именно так: ручка со слоем, но без модуля не собирается, и
 * два значения модуля в одном корне роняют сборку.
 */

import { testTransport, TestTransport$ } from './__fixtures__/transport';
import { SubscriptionClosed, SubscriptionOpened } from './contracts';
import { tracked } from './layer';
import { subscriptions } from './module';
import { SubscriptionRegistry } from './registry';
import type { SubscriptionEvent } from './types';

import { describe, expect, it } from '@jest/globals';
import { makeAppModule } from '@nestling/app';
import { events, Ok } from '@nestling/contracts';
import type { Output } from '@nestling/pipeline';
import { compose, makeEndpoint, makePipeline } from '@nestling/pipeline';
import { implement } from '@nestling/ports';
import { assembleTest } from '@nestling/testing';
import { z } from 'zod';

const Tick = z.object({ n: z.number() });
type Tick = z.infer<typeof Tick>;

const FeedEvent = z.object({ type: z.string(), id: z.string() });
type FeedEvent = z.infer<typeof FeedEvent>;

/** Открытая подписка: живёт, пока её не завершат сигналом */
async function* ticks(signal: AbortSignal): AsyncIterableIterator<Tick> {
  let n = 0;

  while (!signal.aborted) {
    n += 1;
    yield { n };
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** Ручка-подписка: композирована от `tracked`, слушает свой сигнал */
const Ticks = makeEndpoint({
  transport: TestTransport$,
  pattern: 'ticks:watch',
  output: events(Tick),
  pipeline: tracked,
  handle: async (
    _payload: unknown,
    meta: { subscription: { id: string; signal: AbortSignal } },
  ): Output<AsyncIterable<Tick>> => new Ok(ticks(meta.subscription.signal)),
});

/** Живой просмотр ленты — сам подписка (рекурсивный случай) */
const Feed = makeEndpoint({
  transport: TestTransport$,
  pattern: 'subscriptions:watch',
  output: events(FeedEvent),
  pipeline: tracked,
  deps: [SubscriptionRegistry],
  handle:
    (registry: SubscriptionRegistry) =>
    async (
      _payload: unknown,
      meta: { subscription: { id: string; signal: AbortSignal } },
    ): Output<AsyncIterable<FeedEvent>> => {
      const feed = registry.watch(meta.subscription.signal);

      return new Ok(
        (async function* () {
          for await (const event of feed) {
            yield { type: event.type, id: event.info.id };
          }
        })(),
      );
    },
});

/** Поток из ответа границы: у `events`-ручки значение — итератор */
function streamOf<T>(response: unknown): AsyncIterableIterator<T> {
  return (response as { value: AsyncIterableIterator<T> }).value;
}

/** Ждёт условия, не гадая про число микрозадач */
async function waitFor(
  predicate: () => boolean,
  attempts = 100,
): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  throw new Error('условие не наступило');
}

describe('subscriptions(): реестр в собранном приложении', () => {
  it('видит подписку, убивает её и снимает запись', async () => {
    await using app = await assembleTest({
      modules: [
        subscriptions(),
        makeAppModule({ name: 'module:ticks', endpoints: [Ticks] }),
      ],
      transports: [testTransport()],
    });

    const registry = app.get(SubscriptionRegistry);
    expect(registry).not.toBeNull();
    if (!registry) {
      return;
    }

    const response = await app.call(Ticks);
    expect(response.isSuccess).toBe(true);

    const [info] = registry.list();
    expect(info).toMatchObject({
      transport: 'test',
      pattern: 'ticks:watch',
      kind: 'events',
    });

    const items: Tick[] = [];
    for await (const tick of streamOf<Tick>(response)) {
      items.push(tick);
      if (items.length === 2) {
        expect(registry.abort(info.id, 'админ закрыл подписку')).toBe(true);
      }
    }

    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(registry.size).toBe(0);
  });

  it('снимает записи на SHUTDOWN и закрывает ленту', async () => {
    const app = await assembleTest({
      modules: [
        subscriptions(),
        makeAppModule({ name: 'module:ticks', endpoints: [Ticks] }),
      ],
      transports: [testTransport()],
    });

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const registry = app.get(SubscriptionRegistry)!;
    const seen: SubscriptionEvent[] = [];
    const feed = registry.watch();

    const observing = (async () => {
      for await (const event of feed) {
        seen.push(event);
      }
    })();

    const response = await app.call(Ticks);
    const stream = streamOf<Tick>(response);

    // Один элемент прочитан — подписка точно активна
    await stream.next();
    expect(registry.size).toBe(1);

    // SHUTDOWN: сигнал приложения взведён, поток дотекает, `.finally`
    // снимает запись
    await app.close();
    await stream.next();
    await waitFor(() => registry.size === 0);

    // Лента закрыта — наблюдатель завершился нормально, а не завис.
    // Событие закрытия он при этом уже не увидит: `@OnDestroy` освобождает
    // ленту раньше, чем дотекут потоки, и это цена детерминированного
    // освобождения — наблюдатель ленты сам уходит на SHUTDOWN
    await expect(observing).resolves.toBeUndefined();
    expect(seen.map((event) => event.type)).toEqual(['opened']);
  });

  it('живой просмотр сам является подпиской и не видит своего opened', async () => {
    await using app = await assembleTest({
      modules: [
        subscriptions(),
        makeAppModule({ name: 'module:feed', endpoints: [Feed, Ticks] }),
      ],
      transports: [testTransport()],
    });

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const registry = app.get(SubscriptionRegistry)!;

    const watching = await app.call(Feed);
    const feed = streamOf<FeedEvent>(watching);

    // Ручка живого просмотра трекается наравне с прочими
    expect(registry.list({ pattern: 'subscriptions:watch' })).toHaveLength(1);

    const ticks = await app.call(Ticks);
    const stream = streamOf<Tick>(ticks);
    const [watched] = registry.list({ pattern: 'ticks:watch' });

    // Собственного `opened` живой просмотр не видит: оно опубликовано до
    // вызова хендлера, то есть до того, как он подписался на ленту
    const first = await feed.next();
    expect(first.value).toEqual({ type: 'opened', id: watched.id });

    // Один элемент прочитан — поток начат, и его закрытие исполнит
    // `.finally` (см. `core-limits.spec.ts`, находка №4)
    await stream.next();
    registry.abort(watched.id);
    await stream.return?.();
    await waitFor(() => registry.list({ pattern: 'ticks:watch' }).length === 0);

    const second = await feed.next();
    expect(second.value).toMatchObject({ type: 'closed', id: watched.id });

    await feed.return?.();
  });

  it('роняет сборку, если слой есть, а модуля нет', async () => {
    await expect(
      assembleTest({
        modules: [makeAppModule({ name: 'module:ticks', endpoints: [Ticks] })],
        transports: [testTransport()],
      }),
    ).rejects.toThrow(/TrackSubscription/);
  });

  it('роняет сборку на двух значениях модуля', async () => {
    await expect(
      assembleTest({
        modules: [
          subscriptions(),
          subscriptions({ node: 'other' }),
          makeAppModule({ name: 'module:ticks', endpoints: [Ticks] }),
        ],
        transports: [testTransport()],
      }),
    ).rejects.toThrow(/module:subscriptions/);
  });
});

describe('subscriptions(): факты жизненного цикла', () => {
  it('без публикации вызывателей контрактов в графе нет', async () => {
    await using app = await assembleTest({
      modules: [
        subscriptions(),
        makeAppModule({ name: 'module:ticks', endpoints: [Ticks] }),
      ],
      transports: [testTransport()],
    });

    expect(app.get(SubscriptionOpened.emitter)).toBeNull();
    expect(app.get(SubscriptionClosed.emitter)).toBeNull();
  });

  it('с публикацией и нулём подписчиков собирается, emit — no-op', async () => {
    await using app = await assembleTest({
      modules: [
        subscriptions({ publish: true, node: 'node-1' }),
        makeAppModule({ name: 'module:ticks', endpoints: [Ticks] }),
      ],
      transports: [testTransport()],
    });

    expect(app.get(SubscriptionOpened.emitter)).not.toBeNull();

    const response = await app.call(Ticks);
    const stream = streamOf<Tick>(response);
    await stream.next();
    await stream.return?.();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(app.get(SubscriptionRegistry)!.size).toBe(0);
  });

  it('подписчик другой фичи получает оба факта', async () => {
    const facts: string[] = [];

    const OpenedInOps = implement(SubscriptionOpened, {
      subscriber: 'ops',
      handle: async (payload: { id: string; node?: string }) => {
        facts.push(`opened:${payload.node}:${payload.id.length > 0}`);

        return undefined;
      },
    });

    const ClosedInOps = implement(SubscriptionClosed, {
      subscriber: 'ops',
      handle: async (payload: { reason: string }) => {
        facts.push(`closed:${payload.reason}`);

        return undefined;
      },
    });

    await using app = await assembleTest({
      modules: [
        subscriptions({ publish: true, node: 'node-1' }),
        makeAppModule({
          name: 'module:ticks',
          endpoints: [Ticks, OpenedInOps, ClosedInOps],
        }),
      ],
      transports: [testTransport()],
    });

    const response = await app.call(Ticks);
    const stream = streamOf<Tick>(response);
    await stream.next();
    await stream.return?.();

    await waitFor(() => facts.length === 2);

    expect(facts).toEqual(['opened:node-1:true', 'closed:completed']);
  });
});

describe('subscriptions(): слой композируется поверх прикладного', () => {
  it('складывается с внешним слоем без потери типов', async () => {
    const observability = makePipeline().pre(() => ({ requestId: 'r-1' }));
    const composed = compose(observability, tracked);

    const Watched = makeEndpoint({
      transport: TestTransport$,
      pattern: 'ticks:composed',
      output: events(Tick),
      pipeline: composed,
      handle: async (
        _payload: unknown,
        meta: {
          requestId: string;
          subscription: { id: string; signal: AbortSignal };
        },
      ): Output<AsyncIterable<Tick>> => {
        expect(meta.requestId).toBe('r-1');

        return new Ok(ticks(meta.subscription.signal));
      },
    });

    await using app = await assembleTest({
      modules: [
        subscriptions(),
        makeAppModule({ name: 'module:composed', endpoints: [Watched] }),
      ],
      transports: [testTransport()],
    });

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const registry = app.get(SubscriptionRegistry)!;
    const response = await app.call(Watched);
    const stream = streamOf<Tick>(response);

    await stream.next();
    expect(registry.size).toBe(1);

    await stream.return?.();
    expect(registry.size).toBe(0);
  });
});
