/**
 * Слой `tracked` в рантайме пайплайна: резолвер-заглушка вместо контейнера,
 * настоящий `executeWithHandler`.
 *
 * Проверяется ровно то, ради чего слой существует: запись живёт столько же,
 * сколько подписка, и комбинированный сигнал закрывает все три причины
 * отмены, не трогая сигнал запроса.
 */

import { makeCtx } from './__fixtures__/context';
import type { TrackSubscription, UntrackSubscription } from './layer';
import { tracked } from './layer';
import { SubscriptionRegistry } from './registry';
import type { TrackedSubscription } from './types';

import type { Constructor } from '@common/misc';
import { describe, expect, it } from '@jest/globals';
import { events, Ok } from '@nestling/operations';
import type { ExtendableContext, ResponseContext } from '@nestling/pipeline';
import { compose, makePipeline } from '@nestling/pipeline';
import { z } from 'zod';

const Item = z.object({ id: z.string() });
type Item = z.infer<typeof Item>;

// ---------------------------------------------------------------------------
// Типы слоя (4.3): добавка и отложенные зависимости
// ---------------------------------------------------------------------------

type Types = NonNullable<(typeof tracked)['$types']>;

/** `.pre` кладёт в накопленный input ровно одно типизированное поле */
const accHasSubscription: Types['acc'] extends {
  subscription: TrackedSubscription;
}
  ? true
  : never = true;

/** Оба класс-юнита попадают в `TNeeds`: без модуля слой не соберётся */
const needsBothUnits: [
  typeof TrackSubscription,
  typeof UntrackSubscription,
][number] extends Types['needs']
  ? true
  : never = true;

// ---------------------------------------------------------------------------
// Рантайм
// ---------------------------------------------------------------------------

/** Резолвер-заглушка: то же, что делает контейнер на WIRE */
const boundTo = (registry: SubscriptionRegistry) =>
  tracked.bind(
    (ctor: Constructor<unknown>) =>
      new (ctor as new (r: SubscriptionRegistry) => unknown)(registry),
  );

/** Контекст отслеживаемого endpoint'а в типах слоя */
const ctxFor = (options: Parameters<typeof makeCtx>[0] = {}) =>
  makeCtx(options) as unknown as ExtendableContext<{
    subscription: TrackedSubscription;
  }>;

async function* threeItems(): AsyncIterableIterator<Item> {
  yield { id: '1' };
  yield { id: '2' };
  yield { id: '3' };
}

/** Поток, живущий до взведения сигнала — как настоящая подписка */
async function* untilAborted(signal: AbortSignal): AsyncIterableIterator<Item> {
  let sent = 0;

  while (!signal.aborted) {
    sent += 1;
    yield { id: String(sent) };
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe('tracked: запись живёт столько же, сколько подписка', () => {
  it('появляется до вызова хендлера и снимается после ответа', async () => {
    const registry = new SubscriptionRegistry();
    const seen: number[] = [];

    const response = await boundTo(registry).executeWithHandler(
      async () => {
        // Хендлер уже исполняется — запись обязана быть видна
        seen.push(registry.size);

        return new Ok({ id: '1' });
      },
      ctxFor({ output: Item }),
    );

    expect(response.isSuccess).toBe(true);
    expect(seen).toEqual([1]);
    expect(registry.size).toBe(0);
  });

  it('для потоковой формы снимается, когда поток дотёк', async () => {
    const registry = new SubscriptionRegistry();

    const response = await boundTo(registry).executeWithHandler(
      async () => new Ok(threeItems()),
      ctxFor({ output: events(Item) }),
    );

    // Ответ отдан, поток ещё не прочитан: подписка активна
    expect(registry.size).toBe(1);
    const [info] = registry.list();
    expect(info).toMatchObject({ kind: 'events', itemsOut: 0 });

    const items: Item[] = [];
    for await (const item of (response as { value: AsyncIterable<Item> })
      .value) {
      items.push(item);
      // Счётчик отданных элементов актуален на момент чтения снимка
      expect(registry.get(info.id)?.itemsOut).toBe(items.length);
    }

    expect(items).toHaveLength(3);
    expect(registry.size).toBe(0);
  });

  it('для потоковой формы снимается, когда потребитель закрыл поток', async () => {
    const registry = new SubscriptionRegistry();

    const response = await boundTo(registry).executeWithHandler(
      async () => new Ok(threeItems()),
      ctxFor({ output: events(Item) }),
    );

    const iterator = (response as { value: AsyncIterableIterator<Item> }).value;
    // Прочитан один элемент — дальше потребитель уходит
    await iterator.next();
    await iterator.return?.();

    expect(registry.size).toBe(0);
  });

  it('снимается, даже если хендлер не выполнялся', async () => {
    const registry = new SubscriptionRegistry();
    let handled = false;

    // Внутренний слой отказывает в своём pre — уже после регистрации
    const refusing = makePipeline<{ subscription: TrackedSubscription }>().pre(
      () => {
        throw new Error('внутренний pre отказал');
      },
    );

    const pipeline = compose(tracked, refusing).bind(
      (ctor: Constructor<unknown>) =>
        new (ctor as new (r: SubscriptionRegistry) => unknown)(registry),
    );

    const response: ResponseContext = await pipeline.executeWithHandler(
      () => {
        handled = true;

        return new Ok({ id: '1' });
      },
      ctxFor({ output: Item }),
      // Отказ ожидаемый: дефолтный наблюдатель проверки на границе только
      // шумел бы
      { onUnknownFail: (): void => undefined },
    );

    expect(handled).toBe(false);
    expect(response.isSuccess).toBe(false);
    expect(registry.size).toBe(0);
  });
});

describe('tracked: комбинированный сигнал', () => {
  it('завершает итерацию по взведению сигнала запроса', async () => {
    const registry = new SubscriptionRegistry();
    const request = new AbortController();

    const response = await boundTo(registry).executeWithHandler(
      async (_payload, meta) => new Ok(untilAborted(meta.subscription.signal)),
      ctxFor({ output: events(Item), signal: request.signal }),
    );

    const items: Item[] = [];
    for await (const item of (response as { value: AsyncIterable<Item> })
      .value) {
      items.push(item);
      if (items.length === 2) {
        request.abort();
      }
    }

    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(registry.size).toBe(0);
  });

  it('завершает итерацию по registry.abort, не трогая meta.signal', async () => {
    const registry = new SubscriptionRegistry();
    const request = new AbortController();
    let requestSignal: AbortSignal | undefined;

    const response = await boundTo(registry).executeWithHandler(
      async (_payload, meta) => {
        requestSignal = meta.signal;

        return new Ok(untilAborted(meta.subscription.signal));
      },
      ctxFor({ output: events(Item), signal: request.signal }),
    );

    const [{ id }] = registry.list();
    const items: Item[] = [];

    for await (const item of (response as { value: AsyncIterable<Item> })
      .value) {
      items.push(item);
      if (items.length === 2) {
        expect(registry.abort(id, 'админ закрыл подписку')).toBe(true);
      }
    }

    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(registry.size).toBe(0);

    // Гарантия `request-abort-signal` не нарушена: kill — это второй канал
    expect(requestSignal).toBe(request.signal);
    expect(requestSignal?.aborted).toBe(false);
    expect(request.signal.aborted).toBe(false);
  });
});

describe('tracked: нет накопления', () => {
  it('тысяча циклов «открыл — закрыл» оставляет реестр пустым', async () => {
    const registry = new SubscriptionRegistry();
    // Долгоживущий сигнал приложения — тот самый, к которому цепляется
    // каждый композитный
    const app = new AbortController();
    const composites: AbortSignal[] = [];

    for (let i = 0; i < 1000; i += 1) {
      await boundTo(registry).executeWithHandler(
        async (_payload, meta) => {
          composites.push(meta.subscription.signal);

          return new Ok({ id: String(i) });
        },
        ctxFor({ output: Item, signal: app.signal }),
      );
    }

    expect(registry.size).toBe(0);
    // Каждый композитный сигнал взведён — значит, отвязан от `app.signal`
    // детерминированно, а не по факту сборки мусора
    expect(composites).toHaveLength(1000);
    expect(composites.every((signal) => signal.aborted)).toBe(true);
    expect(app.signal.aborted).toBe(false);
  });
});

describe('tracked: типы слоя', () => {
  it('добавка и отложенные зависимости объявлены', () => {
    expect(accHasSubscription).toBe(true);
    expect(needsBothUnits).toBe(true);
  });
});
