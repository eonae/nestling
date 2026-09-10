/**
 * Рантайм потоковых форм в пайплайне: отложенный `.finally`, исходы,
 * счётчики `summary`, поэлементная валидация и kernel-отказы цепочек.
 */

import { spyLogger } from '../../logger/__fixtures__/spy.js';

import type { EndpointMeta, ResponseContext } from './types/context.js';
import { makeEmptyContext } from './types/context.js';
import type { Raw } from './types/raw.js';
import type { Outcome } from './types/unit.js';
import { ClientDisconnectedError, TransportClosingError } from './abort.js';
import { isMidStreamFailure, makePipeline } from './pipeline.js';

import { events, Ok, stream, Topic } from '@nestlingjs/operations';
import { z } from 'zod';

const Row = z.object({ id: z.string() });
type Row = z.infer<typeof Row>;

const raw = (payload?: unknown): Raw => ({
  transport: 'test',
  pattern: 'GET /rows',
  payload,
  attributes: {},
});

const meta = (
  input?: EndpointMeta['input'],
  output?: EndpointMeta['output'],
): EndpointMeta => ({
  transport: 'test',
  pattern: 'GET /rows',
  input,
  output,
});

/** Собирает поток целиком; отдаёт и элементы, и ошибку, если она была */
async function drain(
  value: unknown,
): Promise<{ items: unknown[]; error?: unknown }> {
  const items: unknown[] = [];
  try {
    for await (const item of value as AsyncIterable<unknown>) {
      items.push(item);
    }
  } catch (error) {
    return { items, error };
  }
  return { items };
}

async function* rows(...ids: string[]): AsyncIterableIterator<Row> {
  for (const id of ids) {
    yield { id };
  }
}

/**
 * Источник-объект: считает закрытия и отдаёт элементы без генератора.
 *
 * Генератор для этих сценариев не годится — его тело не выполняется до
 * первого `next()`, и закрытие до старта было бы не видно.
 */
function counted(...ids: string[]): AsyncIterableIterator<Row> & {
  closes: number;
} {
  let index = 0;

  const source = {
    closes: 0,

    [Symbol.asyncIterator](): AsyncIterableIterator<Row> {
      return source;
    },

    next: async (): Promise<IteratorResult<Row>> =>
      index < ids.length
        ? { value: { id: ids[index++] }, done: false }
        : { value: undefined, done: true },

    return: async (): Promise<IteratorResult<Row>> => {
      source.closes += 1;

      return { value: undefined, done: true };
    },

    throw: async (error?: unknown): Promise<IteratorResult<Row>> => {
      source.closes += 1;

      throw error;
    },
  };

  return source;
}

/** Поток, отдающий элемент и падающий: mid-stream отказ */
async function* failing(): AsyncIterableIterator<Row> {
  yield { id: '1' };
  throw new Error('boom');
}

/** Поток, второй элемент которого не проходит схему-лист */
async function* brokenTail(): AsyncIterableIterator<unknown> {
  yield { id: '1' };
  yield { id: 42 };
}

/** Поток, единственный элемент которого не проходит схему-лист */
async function* brokenOnly(): AsyncIterableIterator<unknown> {
  yield { id: 42 };
}

/** Логгер-шпион: умолчание ядра шумит в выводе тестов */
const silent = { logger: spyLogger().logger };

/** Что увидел наблюдатель исхода потокового ответа */
interface Seen {
  outcomes: Outcome[];
  itemsOut?: number;
}

/** Отдаёт потоковый ответ endpoint'а вместе с наблюдателем исхода */
async function respond(
  source: AsyncIterable<Row>,
  seen: Seen,
  options: { signal?: AbortSignal; output?: EndpointMeta['output'] } = {},
): Promise<AsyncIterableIterator<Row>> {
  const pipeline = makePipeline().finally((outcome, _response, ctx) => {
    seen.outcomes.push(outcome);
    seen.itemsOut = ctx.summary.itemsOut;
  });

  const ctx = makeEmptyContext(
    raw(),
    meta(undefined, options.output ?? events(Row)),
    options.signal,
  );

  const response = await pipeline.executeWithHandler(
    async () => new Ok(source),
    ctx,
    silent,
  );

  return (response as unknown as { value: AsyncIterableIterator<Row> }).value;
}

describe('отложенный .finally у потокового ответа', () => {
  it('вызывается после последнего элемента, а не после ответной фазы', async () => {
    const events_: string[] = [];

    const pipeline = makePipeline().finally((outcome) => {
      events_.push(`finally:${outcome}`);
    });

    const ctx = makeEmptyContext(raw(), meta(undefined, stream(Row)));
    const response = await pipeline.executeWithHandler(
      async () => new Ok(rows('1', '2')),
      ctx,
    );

    // Ответная фаза прошла — но исход ещё не объявлен
    expect(events_).toEqual([]);

    expect(response.isSuccess).toBe(true);
    for await (const item of (response as { value: AsyncIterable<Row> })
      .value) {
      events_.push(`item:${item.id}`);
    }

    expect(events_).toEqual(['item:1', 'item:2', 'finally:completed']);
  });

  it('выполняется ровно один раз при закрытии итератора потребителем', async () => {
    const outcomes: Outcome[] = [];

    const pipeline = makePipeline().finally((outcome) => {
      outcomes.push(outcome);
    });

    const ctx = makeEmptyContext(raw(), meta(undefined, stream(Row)));
    const response = await pipeline.executeWithHandler(
      async () => new Ok(rows('1', '2', '3')),
      ctx,
    );

    const iterator = (response as { value: AsyncIterable<Row> }).value;
    for await (const item of iterator) {
      if (item.id === '1') {
        break;
      }
    }

    // Повторное закрытие ничего не меняет
    await (iterator as AsyncIterableIterator<Row>).return?.();

    expect(outcomes).toEqual(['completed']);
  });

  it('дисконнект даёт disconnected, shutdown — aborted', async () => {
    for (const [reason, expected] of [
      [new ClientDisconnectedError(), 'disconnected'],
      [new TransportClosingError(), 'aborted'],
    ] as const) {
      const outcomes: Outcome[] = [];
      const controller = new AbortController();

      const pipeline = makePipeline().finally((outcome) => {
        outcomes.push(outcome);
      });

      const ctx = makeEmptyContext(
        raw(),
        meta(undefined, events(Row)),
        controller.signal,
      );
      const response = await pipeline.executeWithHandler(
        async () => new Ok(rows('1', '2', '3')),
        ctx,
      );

      const iterator = (response as { value: AsyncIterableIterator<Row> })
        .value;
      await iterator.next();
      controller.abort(reason);
      await iterator.return?.();

      expect(outcomes).toEqual([expected]);
    }
  });

  it('ошибка посреди потока даёт failed, .catch не вызывается', async () => {
    const seen: string[] = [];

    const pipeline = makePipeline()
      .catch(() => {
        seen.push('catch');
      })
      .finally((outcome) => {
        seen.push(`finally:${outcome}`);
      });

    const ctx = makeEmptyContext(raw(), meta(undefined, stream(Row)));
    const response = await pipeline.executeWithHandler(
      async () => new Ok(failing()),
      ctx,
      silent,
    );

    const { items, error } = await drain(
      (response as { value: unknown }).value,
    );

    expect(items).toEqual([{ id: '1' }]);
    expect(isMidStreamFailure(error)).toBe(true);
    expect(seen).toEqual(['finally:failed']);
  });

  it('mid-stream отказ нормализуется проверкой операции отказов', async () => {
    const spy = spyLogger();

    const ctx = makeEmptyContext(raw(), meta(undefined, stream(Row)));
    const response = await makePipeline().executeWithHandler(
      async () => new Ok(failing()),
      ctx,
      { logger: spy.logger },
    );

    const { error } = await drain((response as { value: unknown }).value);

    expect(isMidStreamFailure(error)).toBe(true);
    expect((error as { response: ResponseContext }).response).toMatchObject({
      isSuccess: false,
      status: 'internal_error',
      value: { code: 'internal_error', error: 'Internal server error' },
    });
    expect(spy.entries).toHaveLength(1);
  });

  it('не-потоковый endpoint финализируется сразу, как раньше', async () => {
    const outcomes: Outcome[] = [];

    const pipeline = makePipeline().finally((outcome) => {
      outcomes.push(outcome);
    });

    const ctx = makeEmptyContext(raw(), meta(undefined, Row));
    await pipeline.executeWithHandler(async () => new Ok({ id: '1' }), ctx);

    expect(outcomes).toEqual(['completed']);
  });
});

describe('закрытие непрочитанного потокового ответа', () => {
  it('.finally выполняется с исходом completed и нулевым itemsOut', async () => {
    const seen: Seen = { outcomes: [] };
    const iterator = await respond(rows('1', '2'), seen);

    await iterator.return?.();

    expect(seen.outcomes).toEqual(['completed']);
    expect(seen.itemsOut).toBe(0);
  });

  it('дисконнект до первого элемента даёт disconnected', async () => {
    const seen: Seen = { outcomes: [] };
    const controller = new AbortController();
    const iterator = await respond(rows('1', '2'), seen, {
      signal: controller.signal,
    });

    controller.abort(new ClientDisconnectedError());
    await iterator.return?.();

    expect(seen.outcomes).toEqual(['disconnected']);
  });

  it('иное взведение сигнала до первого элемента даёт aborted', async () => {
    const seen: Seen = { outcomes: [] };
    const controller = new AbortController();
    const iterator = await respond(rows('1', '2'), seen, {
      signal: controller.signal,
    });

    controller.abort(new TransportClosingError());
    await iterator.return?.();

    expect(seen.outcomes).toEqual(['aborted']);
  });

  it('двойной return() выполняет .finally ровно один раз', async () => {
    const seen: Seen = { outcomes: [] };
    const iterator = await respond(rows('1', '2'), seen);

    await iterator.return?.();
    await expect(iterator.return?.()).resolves.toMatchObject({ done: true });

    expect(seen.outcomes).toEqual(['completed']);
  });

  it('throw() до первого элемента даёт failed и бросает MidStreamFailure', async () => {
    const seen: Seen = { outcomes: [] };
    const iterator = await respond(rows('1', '2'), seen);

    let thrown: unknown;
    try {
      await iterator.throw?.(new Error('boom'));
    } catch (error) {
      thrown = error;
    }

    expect(isMidStreamFailure(thrown)).toBe(true);

    expect(seen.outcomes).toEqual(['failed']);
  });

  it('источник закрыт, хотя не прочитан ни один элемент', async () => {
    const seen: Seen = { outcomes: [] };
    const source = counted('1', '2');
    const iterator = await respond(source, seen);

    await iterator.return?.();

    expect(source.closes).toBe(1);
  });

  it('подписка на тему снимается закрытием непрочитанного ответа', async () => {
    const seen: Seen = { outcomes: [] };
    const topic = new Topic<Row>();
    const iterator = await respond(topic.subscribe(), seen);

    expect(topic.subscribers).toBe(1);
    await iterator.return?.();

    expect(topic.subscribers).toBe(0);
    expect(seen.outcomes).toEqual(['completed']);
  });

  it('объявленная item-цепочка закрытию не мешает', async () => {
    const seen: Seen = { outcomes: [] };
    const topic = new Topic<Row>();
    const iterator = await respond(topic.subscribe(), seen, {
      output: events(Row).throttle(10),
    });

    expect(topic.subscribers).toBe(1);
    await iterator.return?.();

    expect(topic.subscribers).toBe(0);
  });

  it('после прочитанного элемента источник закрывается ровно один раз', async () => {
    const seen: Seen = { outcomes: [] };
    const source = counted('1', '2', '3');
    const iterator = await respond(source, seen);

    await iterator.next();
    await iterator.return?.();

    expect(source.closes).toBe(1);
    expect(seen.itemsOut).toBe(1);
  });
});

describe('summary', () => {
  it('itemsOut считает отданные элементы', async () => {
    let итог = { itemsIn: -1, itemsOut: -1 };

    const pipeline = makePipeline().finally((_outcome, _res, ctx) => {
      итог = { ...ctx.summary };
    });

    const ctx = makeEmptyContext(raw(), meta(undefined, stream(Row)));
    const response = await pipeline.executeWithHandler(
      async () => new Ok(rows('1', '2', '3')),
      ctx,
    );

    await drain((response as { value: unknown }).value);

    expect(итог).toMatchObject({ itemsIn: 0, itemsOut: 3 });
  });

  it("у не-потокового endpoint'а счётчики — нули", async () => {
    let итог = { itemsIn: -1, itemsOut: -1 };

    const pipeline = makePipeline().finally((_outcome, _res, ctx) => {
      итог = { ...ctx.summary };
    });

    const ctx = makeEmptyContext(raw(), meta(undefined, Row));
    await pipeline.executeWithHandler(async () => new Ok({ id: '1' }), ctx);

    expect(итог).toMatchObject({ itemsIn: 0, itemsOut: 0 });
  });
});

describe('поэлементная валидация выхода', () => {
  it('невалидный элемент — mid-stream отказ, а не тихая отправка', async () => {
    const ctx = makeEmptyContext(raw(), meta(undefined, stream(Row)));
    const response = await makePipeline().executeWithHandler(
      async () => new Ok(brokenTail()),
      ctx,
      silent,
    );

    const { items, error } = await drain(
      (response as { value: unknown }).value,
    );

    expect(items).toEqual([{ id: '1' }]);
    expect(isMidStreamFailure(error)).toBe(true);
  });

  it('opt-out пропускает валидацию', async () => {
    const ctx = makeEmptyContext(
      raw(),
      meta(undefined, stream(Row, { validate: false })),
    );
    const response = await makePipeline().executeWithHandler(
      async () => new Ok(brokenOnly()),
      ctx,
    );

    const { items, error } = await drain(
      (response as { value: unknown }).value,
    );

    expect(error).toBeUndefined();
    expect(items).toEqual([{ id: 42 }]);
  });

  it('выходная цепочка применяется до валидации', async () => {
    const seen: Row[] = [];

    const ctx = makeEmptyContext(
      raw(),
      meta(
        undefined,
        stream(Row)
          .tap((row) => seen.push(row))
          .filter((row) => row.id !== '2'),
      ),
    );
    const response = await makePipeline().executeWithHandler(
      async () => new Ok(rows('1', '2', '3')),
      ctx,
    );

    const { items } = await drain((response as { value: unknown }).value);

    expect(seen).toHaveLength(3);
    expect(items).toEqual([{ id: '1' }, { id: '3' }]);
  });
});
