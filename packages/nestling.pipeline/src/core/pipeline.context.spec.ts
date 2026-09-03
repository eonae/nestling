/**
 * Scope запроса в рантайме пайплайна.
 *
 * Предмет проверки — проекция: что видит код **любой глубины**, вызванный
 * из юнита, хендлера, ответной фазы и тела потока. Ридер здесь
 * создаётся напрямую (`makeCtxReader`), потому что предмет — рантайм
 * пайплайна, а не DI: узел графа проверяется тестами kernel-модуля.
 */

import type { CtxReader } from './context/reader.js';
import { makeCtxReader } from './context/reader.js';
import { RequestId, Signal } from './context/well-known.js';
import type { EndpointMeta, ExtendableContext } from './types/context.js';
import { makeEmptyContext } from './types/context.js';
import type { Raw } from './types/raw.js';
import type { AnyPipeline, Pipeline } from './pipeline.js';
import { compose, makePipeline } from './pipeline.js';

import { describe, expect, it } from '@jest/globals';
import type { AnyInput, AnyOutput, EmptyInput } from '@nestling/operations';
import { events, Ok, stream } from '@nestling/operations';
import { z } from 'zod';

/** Схема-лист потоковых форм: предмет теста — scope, а не валидация */
const Item = z.object({
  seen: z.string().optional(),
  n: z.number().optional(),
});

const requestId = makeCtxReader(RequestId.key) as CtxReader<string>;
const signal = makeCtxReader(Signal.key) as CtxReader<AbortSignal>;

/** Контекст запроса — тот же, что собирает транспорт */
function makeCtx(
  output?: AnyOutput,
  abort?: AbortSignal,
): ExtendableContext<EmptyInput> {
  const raw: Raw = {
    transport: 'test',
    pattern: 'TEST /',
    payload: undefined,
    attributes: {},
  };

  const endpoint: EndpointMeta = {
    transport: 'test',
    pattern: 'TEST /',
    ...(output === undefined ? {} : { output }),
  };

  return makeEmptyContext(raw, endpoint, abort);
}

/** Исполняет пайплайн так же, как это делает транспорт */
async function run(
  pipeline: AnyPipeline,
  handler: (payload: unknown, meta: any) => unknown,
  ctx: ExtendableContext<EmptyInput> = makeCtx(),
) {
  const executable = pipeline as unknown as Pipeline<
    EmptyInput,
    AnyInput,
    never
  >;

  return executable.executeWithHandler(
    handler as never,
    ctx as ExtendableContext<AnyInput>,
    { onUnknownFail: (): void => undefined },
  );
}

describe('проекция обновляется после каждого .pre-юнита', () => {
  it('юнит видит поля предыдущих юнитов и не видит своих последователей', async () => {
    const seen: (string | undefined)[] = [];
    const observe = () => {
      seen.push(requestId.peek());
    };

    const pipeline = makePipeline()
      .pre(() => {
        observe();
      })
      .pre(RequestId.provide(() => 'req-1'))
      .pre(() => {
        observe();
      });

    await run(pipeline, () => {
      observe();
      return new Ok({ done: true });
    });

    expect(seen).toEqual([undefined, 'req-1', 'req-1']);
  });

  it('хендлер читает переменную, положенную внешним слоем', async () => {
    const observability = makePipeline().pre(
      RequestId.provide(() => 'req-outer'),
    );
    // Внутренний слой переменную только требует типом — кладёт её внешний
    const inner = makePipeline<{ requestId: string }>().pre(async () => ({}));

    const response = await run(compose(observability, inner), () =>
      Promise.resolve(new Ok({ id: requestId.get() })),
    );

    expect(response).toMatchObject({
      isSuccess: true,
      value: { id: 'req-outer' },
    });
  });

  it('Ctx(Signal) отдаёт сигнал запроса', async () => {
    const controller = new AbortController();
    const ctx = makeCtx(undefined, controller.signal);

    const response = await run(
      makePipeline(),
      () => new Ok({ same: signal.get() === controller.signal }),
      ctx,
    );

    expect(response).toMatchObject({ value: { same: true } });
  });
});

describe('ответная фаза под тем же scope', () => {
  it('.catch и .finally читают проекцию того же запроса', async () => {
    const seen: (string | undefined)[] = [];

    const pipeline = makePipeline()
      .pre(RequestId.provide(() => 'req-2'))
      .catch(() => {
        seen.push(requestId.peek());
      })
      .finally(() => {
        seen.push(requestId.peek());
      });

    await run(pipeline, () => {
      throw new Error('boom');
    });

    expect(seen).toEqual(['req-2', 'req-2']);
  });

  it('после отказа .pre-юнита peek() даёт undefined, а get() бросает', async () => {
    let peeked: string | undefined = 'untouched';
    let thrown: unknown;

    const pipeline = makePipeline()
      .pre(() => {
        throw new Error('pre failed');
      })
      .pre(RequestId.provide(() => 'req-3'))
      .finally(() => {
        peeked = requestId.peek();
        try {
          requestId.get();
        } catch (error) {
          thrown = error;
        }
      });

    await run(pipeline, () => new Ok({}));

    expect(peeked).toBeUndefined();
    expect((thrown as Error).message).toMatch(/response track/);
  });
});

describe('вложенное исполнение', () => {
  it('внутренний scope перекрывает внешний и возвращает его обратно', async () => {
    const inner = makePipeline().pre(RequestId.provide(() => 'inner'));
    const outer = makePipeline().pre(RequestId.provide(() => 'outer'));

    const seen: (string | undefined)[] = [];

    await run(outer, async () => {
      seen.push(requestId.peek());
      await run(inner, () => {
        seen.push(requestId.peek());
        return new Ok({});
      });
      seen.push(requestId.peek());

      return new Ok({});
    });

    expect(seen).toEqual(['outer', 'inner', 'outer']);
    // По выходе из запроса scope закрыт
    expect(requestId.peek()).toBeUndefined();
  });
});

describe('потоковый ответ под тем же scope', () => {
  it('тело ленивого генератора читает переменную на каждом элементе', async () => {
    const pipeline = makePipeline().pre(RequestId.provide(() => 'req-stream'));

    const response = await run(
      pipeline,
      async function* () {
        yield { seen: requestId.peek() };
        yield { seen: requestId.peek() };
      },
      makeCtx(stream(Item)),
    );

    expect(response.isSuccess).toBe(true);

    const items: unknown[] = [];
    for await (const item of (response as { value: AsyncIterable<unknown> })
      .value) {
      items.push(item);
    }

    expect(items).toEqual([{ seen: 'req-stream' }, { seen: 'req-stream' }]);
  });

  it('finally потокового пути читает ту же проекцию', async () => {
    let seen: string | undefined;

    const pipeline = makePipeline()
      .pre(RequestId.provide(() => 'req-finish'))
      .finally(() => {
        seen = requestId.peek();
      });

    const response = await run(
      pipeline,
      async function* () {
        yield { n: 1 };
      },
      makeCtx(events(Item)),
    );

    // Тянем поток до конца — именно закрытие итератора запускает finally
    const drained: unknown[] = [];
    for await (const item of (response as { value: AsyncIterable<unknown> })
      .value) {
      drained.push(item);
    }

    expect(seen).toBe('req-finish');
  });

  it('отложенная задача видит проекцию своего запроса после ответа', async () => {
    const pipeline = makePipeline().pre(RequestId.provide(() => 'req-late'));

    const later = new Promise<string | undefined>((resolve) => {
      void run(pipeline, () => {
        setTimeout(() => resolve(requestId.peek()), 0);

        return new Ok({});
      });
    });

    // Документированное поведение ALS: код, запущенный внутри запроса,
    // продолжает видеть его ячейку с финальным накопленным input
    await expect(later).resolves.toBe('req-late');
  });
});

describe('проекция не меняет исполнения', () => {
  it('порядок фаз и содержимое ответа на трёх слоях прежние', async () => {
    const order: string[] = [];
    const track = (name: string) => (): void => {
      order.push(name);
    };

    const outer = makePipeline()
      .pre(track('pre:outer'))
      .ok(track('ok:outer'))
      .finally(track('finally:outer'));

    const middle = makePipeline()
      .pre(RequestId.provide(() => 'req-4'))
      .pre(track('pre:middle'))
      .ok(track('ok:middle'))
      .finally(track('finally:middle'));

    const inner = makePipeline<{ requestId: string }>()
      .pre(track('pre:inner'))
      .ok(track('ok:inner'))
      .catch(track('catch:inner'))
      .finally(track('finally:inner'));

    const response = await run(compose(outer, middle, inner), () => {
      order.push('handler');

      return new Ok({ done: true });
    });

    expect(response).toMatchObject({
      isSuccess: true,
      status: 'ok',
      value: { done: true },
    });
    expect(order).toEqual([
      'pre:outer',
      'pre:middle',
      'pre:inner',
      'handler',
      'ok:inner',
      'ok:middle',
      'ok:outer',
      'finally:inner',
      'finally:middle',
      'finally:outer',
    ]);
  });
});
