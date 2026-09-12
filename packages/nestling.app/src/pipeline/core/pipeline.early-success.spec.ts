/**
 * Досрочный успех pre-юнита: третий исход.
 *
 * Предмет проверки — исполнение (`done()` завершает endpoint успехом без
 * значения) и признак на пайплайн-значении (`.pre(unit, { done: true })`,
 * `compose`, деривация, `bind`).
 */

import { spyLogger } from '../../logger/__fixtures__/spy.js';

import type { EndpointMeta, ExtendableContext } from './types/context.js';
import { makeEmptyContext } from './types/context.js';
import type { Raw } from './types/raw.js';
import type { Outcome } from './types/unit.js';
import { done, isDone } from './done.js';
import type { AnyPipeline, Pipeline } from './pipeline.js';
import { compose, declaresDone, makePipeline } from './pipeline.js';

import { jest } from '@jest/globals';
import type { AnyInput, AnyPayload, EmptyInput } from '@nestlingjs/operations';
import { makeFail, Ok } from '@nestlingjs/operations';
import { z } from 'zod';

const Rejected = makeFail('bad_request:early_rejected', {
  message: 'Rejected',
});

/** Логгер, глушащий умолчание ядра в выводе тестов */
const silent = spyLogger().logger;

function makeCtx(
  input?: unknown,
  schema?: AnyPayload,
): ExtendableContext<EmptyInput> {
  const raw: Raw = {
    transport: 'test',
    pattern: 'TEST /',
    payload: input,
    attributes: {},
  };

  const endpoint: EndpointMeta = {
    transport: 'test',
    pattern: 'TEST /',
    errors: [Rejected],
    ...(schema === undefined ? {} : { input: schema }),
  };

  return makeEmptyContext(raw, endpoint);
}

/** Исполняет пайплайн так же, как это делает транспорт */
async function run(
  pipeline: AnyPipeline,
  handler: (payload: unknown, meta: Record<string, unknown>) => unknown,
  ctx: ExtendableContext<EmptyInput> = makeCtx(),
) {
  const executable = pipeline as unknown as Pipeline<
    EmptyInput,
    AnyInput,
    never
  >;

  return executable.executeWithHandler(
    handler,
    ctx as ExtendableContext<AnyInput>,
    { exposeErrorDetails: true, logger: silent },
  );
}

describe('досрочный успех: исполнение', () => {
  it('завершает endpoint успехом из середины слоя', async () => {
    const third = jest.fn();
    const handler = jest.fn(() => new Ok({ never: true }));
    const okUnit = jest.fn((): void => {});
    const outcomes: Outcome[] = [];

    const pipeline = makePipeline()
      .pre(() => ({ first: 1 }))
      .pre(() => done(), { done: true })
      .pre(third)
      .ok(okUnit)
      .finally((outcome) => {
        outcomes.push(outcome);
      });

    const response = await run(pipeline, handler);

    expect(response).toEqual({ isSuccess: true, status: 'ok', value: undefined });
    expect(third).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(okUnit).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual(['completed']);
  });

  it('не пишет значение в накопленный input', async () => {
    let seen: AnyInput = {};

    const pipeline = makePipeline()
      .pre(() => ({ first: 1 }))
      .pre(() => done(), { done: true })
      .ok((_res, ctx) => {
        seen = { ...ctx.input };
      });

    await run(pipeline, () => new Ok(undefined));

    expect(seen).toEqual({ first: 1 });
  });

  it('узнаёт досрочный успех перед отказом', async () => {
    // Значение несёт оба дискриминанта: порядок предикатов виден ответом
    const both = { ...done(), isFail: true, code: Rejected.code };

    const response = await run(
      makePipeline().pre(() => both, { done: true }),
      () => new Ok(undefined),
    );

    expect(isDone(both)).toBe(true);
    expect(response.isSuccess).toBe(true);
  });

  it('пропускает проверку входа', async () => {
    const ctx = makeCtx({ amount: 'не число' }, z.object({ amount: z.number() }));

    const response = await run(
      makePipeline().pre(() => done(), { done: true }),
      () => new Ok(undefined),
      ctx,
    );

    expect(response).toEqual({ isSuccess: true, status: 'ok', value: undefined });
  });

  it('роняет запрос, если признак не объявлен', async () => {
    const response = await run(
      makePipeline().pre(function claim() {
        return done();
      }),
      () => new Ok(undefined),
    );

    expect(response.isSuccess).toBe(false);
    expect(response).toMatchObject({
      status: 'internal_error',
      value: { code: 'internal_error' },
    });
    expect((response as { value: { error: string } }).value.error).toContain(
      'done: true',
    );
    expect((response as { value: { error: string } }).value.error).toContain(
      'claim',
    );
  });

  it('отказ того же юнита идёт прежним путём', async () => {
    const handler = jest.fn(() => new Ok(undefined));

    const response = await run(
      makePipeline().pre(() => Rejected(), { errors: [Rejected], done: true }),
      handler,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      isSuccess: false,
      value: { code: Rejected.code },
    });
  });
});

describe('досрочный успех: признак на пайплайн-значении', () => {
  it('makePipeline() признака не несёт', () => {
    expect(declaresDone(makePipeline())).toBe(false);
    expect(declaresDone(makePipeline().pre(() => undefined))).toBe(false);
  });

  it('.pre(unit, { done: true }) ставит признак', () => {
    expect(declaresDone(makePipeline().pre(() => done(), { done: true }))).toBe(
      true,
    );
  });

  it('признак объявляется вместе с отказами', () => {
    const layer = makePipeline().pre(() => done(), {
      errors: [Rejected],
      done: true,
    });

    expect(declaresDone(layer)).toBe(true);
  });

  it('compose объединяет признаки, не трогая аргументы', () => {
    const transaction = makePipeline().pre(() => ({ tx: 1 }));
    const claim = makePipeline().pre(() => done(), { done: true });

    const guarded = compose(transaction, claim);

    expect(declaresDone(guarded)).toBe(true);
    expect(declaresDone(transaction)).toBe(false);
  });

  it('деривация сохраняет признак', () => {
    const guarded = makePipeline()
      .pre(() => done(), { done: true })
      .finally(() => {});

    expect(declaresDone(guarded)).toBe(true);
  });

  it('bind сохраняет признак', () => {
    class Claim {
      handle() {
        return done();
      }
    }

    const layer = makePipeline().pre(Claim, { done: true });
    const bound = layer.bind(() => new Claim());

    expect(declaresDone(bound)).toBe(true);
  });

  it('значение не пайплайна признака не несёт', () => {
    expect(declaresDone(undefined)).toBe(false);
    expect(declaresDone({ done: true })).toBe(false);
  });

  it('признак не логическое значение — ошибка при подключении', () => {
    expect(() =>
      makePipeline().pre(() => done(), {
        done: 'yes',
      } as unknown as { done: boolean }),
    ).toThrow(/'done' must be a boolean/);
  });
});
