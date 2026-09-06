/**
 * Рантайм входного потока: поэлементная валидация, item-цепочка, счётчик
 * `itemsIn`, завершение по сигналу и kernel-отказы цепочек.
 */

import { makePipeline } from '../pipeline.js';
import type { EndpointMeta } from '../types/context.js';
import { makeEmptyContext } from '../types/context.js';
import type { Raw } from '../types/raw.js';

import { bindInputStream } from './bind-stream.js';

import { describeForm, makeSummary, Ok, stream } from '@nestling/operations';
import { z } from 'zod';

const LogChunk = z.object({ level: z.string() });
type LogChunk = z.infer<typeof LogChunk>;

async function* from<T>(items: readonly T[]): AsyncIterableIterator<T> {
  for (const item of items) {
    yield item;
  }
}

const bindContext = (signal?: AbortSignal) => ({
  signal: signal ?? new AbortController().signal,
  summary: makeSummary(),
});

const raw = (payload?: unknown): Raw => ({
  transport: 'test',
  pattern: 'POST /logs',
  payload,
  attributes: {},
});

const meta = (input: EndpointMeta['input']): EndpointMeta => ({
  transport: 'test',
  pattern: 'POST /logs',
  input,
  // errors: не объявлены намеренно — kernel-коды считаются объявленными и без перечисления
});

/** Прогоняет входной поток через пайплайн, как это делает транспорт */
async function runWith(
  form: EndpointMeta['input'],
  items: unknown[],
): Promise<unknown> {
  const ctx = makeEmptyContext(raw(), meta(form));
  ctx.raw.payload = bindInputStream(describeForm(form), from(items), ctx);

  return makePipeline().executeWithHandler(async (payload) => {
    const seen = await collect(payload as unknown as AsyncIterable<unknown>);
    return new Ok({ seen: seen.length });
  }, ctx);
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) {
    items.push(item);
  }
  return items;
}

describe('bindInputStream', () => {
  it('валидирует элементы до цепочки и отказывает по умолчанию', async () => {
    const ctx = bindContext();
    const bound = bindInputStream(
      describeForm(stream(LogChunk)),
      from([{ level: 'info' }, { level: 42 }]),
      ctx,
    );

    await expect(collect(bound)).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('onInvalid: skip отбрасывает элемент и не считает его', async () => {
    const ctx = bindContext();
    const bound = bindInputStream(
      describeForm(stream(LogChunk, { onInvalid: 'skip' })),
      from([{ level: 'info' }, { level: 42 }, { level: 'warn' }]),
      ctx,
    );

    expect(await collect(bound)).toEqual([
      { level: 'info' },
      { level: 'warn' },
    ]);
    expect(ctx.summary.itemsIn).toBe(2);
  });

  it('validate: false пропускает элементы без проверки', async () => {
    const ctx = bindContext();
    const bound = bindInputStream(
      describeForm(stream(LogChunk, { validate: false })),
      from([{ level: 42 }]),
      ctx,
    );

    expect(await collect(bound)).toEqual([{ level: 42 }]);
  });

  it('itemsIn считает то, что дошло до хендлера: фильтр его уменьшает', async () => {
    const ctx = bindContext();
    const source = Array.from({ length: 100 }, (_, index) => ({
      level: index % 5 === 0 ? 'error' : 'debug',
    }));

    const bound = bindInputStream(
      describeForm(stream(LogChunk).filter((c) => c.level === 'error')),
      from(source),
      ctx,
    );

    expect(await collect(bound)).toHaveLength(20);
    expect(ctx.summary.itemsIn).toBe(20);
  });

  it('.batch меняет форму того, что видит хендлер', async () => {
    const ctx = bindContext();
    const bound = bindInputStream(
      describeForm(stream(LogChunk).batch(2)),
      from([{ level: 'a' }, { level: 'b' }, { level: 'c' }]),
      ctx,
    );

    expect(await collect(bound)).toEqual([
      [{ level: 'a' }, { level: 'b' }],
      [{ level: 'c' }],
    ]);
  });

  it('завершается по взведённому сигналу, а не виснет', async () => {
    const controller = new AbortController();
    const ctx = bindContext(controller.signal);

    let closed = false;
    async function* endless(): AsyncIterableIterator<LogChunk> {
      try {
        for (;;) {
          yield { level: 'info' };
        }
      } finally {
        closed = true;
      }
    }

    const bound = bindInputStream<LogChunk>(
      describeForm(stream(LogChunk)),
      endless(),
      ctx,
    );

    const received: LogChunk[] = [];
    for await (const item of bound) {
      received.push(item);
      if (received.length === 2) {
        controller.abort();
      }
    }

    expect(received).toHaveLength(2);
    expect(closed).toBe(true);
  });
});

describe('kernel-отказы цепочек проходят проверку операции отказов', () => {
  it('.limit даёт 413 с кодом payload_too_large, а не 500 internal_error', async () => {
    const response = await runWith(stream(LogChunk).limit(2), [
      { level: 'a' },
      { level: 'b' },
      { level: 'c' },
    ]);

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'payload_too_large',
      value: { code: 'payload_too_large' },
    });
  });

  it('.gapTimeout даёт 504 с кодом timeout', async () => {
    async function* silent(): AsyncIterableIterator<LogChunk> {
      yield { level: 'a' };
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield { level: 'b' };
    }

    const form = stream(LogChunk).gapTimeout(10);
    const ctx = makeEmptyContext(raw(), meta(form));
    ctx.raw.payload = bindInputStream(describeForm(form), silent(), ctx);

    const response = await makePipeline().executeWithHandler(
      async (payload) => {
        await collect(payload as unknown as AsyncIterable<unknown>);
        return new Ok({});
      },
      ctx,
    );

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'timeout',
      value: { code: 'timeout' },
    });
  });

  it('отказ цепочки виден .catch-юниту', async () => {
    const seen: string[] = [];

    const form = stream(LogChunk).limit(1);
    const ctx = makeEmptyContext(raw(), meta(form));
    ctx.raw.payload = bindInputStream(
      describeForm(form),
      from([{ level: 'a' }, { level: 'b' }]),
      ctx,
    );

    await makePipeline()
      .catch((error) => {
        seen.push(`catch:${error.value.code}`);
      })
      .finally((outcome) => {
        seen.push(`finally:${outcome}`);
      })
      .executeWithHandler(async (payload) => {
        await collect(payload as unknown as AsyncIterable<unknown>);
        return new Ok({});
      }, ctx);

    expect(seen).toEqual(['catch:payload_too_large', 'finally:failed']);
  });
});
