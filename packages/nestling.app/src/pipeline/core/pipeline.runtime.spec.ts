/* eslint-disable @typescript-eslint/no-empty-function --
 * noop-юниты — легитимная часть тестов порядка исполнения */
/* eslint-disable unicorn/consistent-function-scoping --
 * сборщики пайплайнов замыкают фикстуры своего describe */
/* eslint-disable unicorn/prefer-structured-clone --
 * JSON round-trip — предмет проверки: отказ обязан пережить потерю прототипа */
/**
 * Рантайм-тесты Pipeline v2
 *
 * В отличие от pipeline.spec.ts (типовые проверки), здесь проверяется
 * реальное поведение выполнения: порядок фаз и слоёв, замена ответа,
 * Partial ctx на error-path, исходы finally, формы юнитов и bind,
 * meta.signal и политика раскрытия ошибок (exposeErrorDetails).
 */

import type { EndpointMeta, ExtendableContext } from './types/context.js';
import { makeEmptyContext } from './types/context.js';
import type { Raw } from './types/raw.js';
import type { PreUnitFn } from './types/unit.js';
import { ClientDisconnectedError, TransportClosingError } from './abort.js';
import type { AnyPipeline, ExecuteOptions, Pipeline } from './pipeline.js';
import { compose, makePipeline } from './pipeline.js';

import { jest } from '@jest/globals';
import type {
  AnyFailDefinition,
  AnyInput,
  EmptyInput,
} from '@nestling/operations';
import { BadRequest, Fail, makeFail, Ok, Timeout } from '@nestling/operations';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Объявленные отказы фикстур.
//
// Рантайм-тестам про порядок фаз незачем ещё и сталкиваться с проверкой
// операции отказов, поэтому отказы, чей статус тесты проверяют,
// объявляются здесь и прописываются в `errors:` контекста. Нормализация
// незадекларированного — предмет отдельного describe.
// ---------------------------------------------------------------------------

const EmailTaken = makeFail('bad_request:email_taken', {
  message: 'Email already taken',
  details: z.object({ field: z.string() }),
});

const NoToken = makeFail('unauthorized:no_token', { message: 'No token' });

const Forbidden = makeFail('forbidden:forbidden_here', { message: 'nope' });

const Mapped = makeFail('bad_request:mapped', { message: 'mapped' });

const Rejected = makeFail('bad_request:rejected', {
  message: 'Rejected on the response track',
});

const declaredErrors = [EmailTaken, NoToken, Forbidden, Mapped, Rejected];

function makeCtx(
  signal?: AbortSignal,
  errors: readonly AnyFailDefinition[] = declaredErrors,
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
    errors,
  };

  return makeEmptyContext(raw, endpoint, signal);
}

type LooseHandler = (
  payload: unknown,
  meta: Record<string, unknown> & {
    signal: AbortSignal;
  },
) => unknown;

/**
 * Выполняет pipeline с ослабленными типами (как это делают транспорты):
 * рантайм-тестам важен порядок исполнения, а не вывод типов.
 *
 * Хук `onUnknownFail` по умолчанию заглушён: дефолтный `console.error`
 * полезен в бою и бесполезен в выводе тестов. Тесты про диагностику
 * ставят свой.
 */
async function run(
  pipeline: AnyPipeline,
  handler: LooseHandler,
  opts: {
    signal?: AbortSignal;
    options?: ExecuteOptions;
    errors?: readonly AnyFailDefinition[];
  } = {},
) {
  const executable = pipeline as unknown as Pipeline<
    EmptyInput,
    AnyInput,
    never
  >;
  return executable.executeWithHandler(
    handler,
    makeCtx(opts.signal, opts.errors) as ExtendableContext<AnyInput>,
    { onUnknownFail: () => {}, ...opts.options },
  );
}

const failingHandler = (): never => {
  throw EmailTaken({ field: 'email' });
};

describe('Pipeline v2 — normalization', () => {
  it('нормализует голое значение в OK', async () => {
    const response = await run(makePipeline(), () => ({ hello: 'world' }));

    expect(response).toEqual({
      isSuccess: true,
      status: 'ok',
      value: { hello: 'world' },
    });
  });

  it('сохраняет статус и заголовки из Ok', async () => {
    const response = await run(makePipeline(), () => {
      return new Ok('created', { id: 1 }, { 'x-test': '1' });
    });

    expect(response).toEqual({
      isSuccess: true,
      status: 'created',
      value: { id: 1 },
      headers: { 'x-test': '1' },
    });
  });
});

describe('Pipeline v2 — порядок фаз одного слоя', () => {
  it('успех: pre по порядку, ok исполняется, catch — нет', async () => {
    const events: string[] = [];

    const pipeline = makePipeline()
      .pre(() => {
        events.push('pre1');
        return;
      })
      .pre(() => {
        events.push('pre2');
        return;
      })
      .ok(() => {
        events.push('ok');
        return;
      })
      .catch(() => {
        events.push('catch');
        return;
      })
      .finally(() => {
        events.push('finally');
      });

    const response = await run(pipeline, () => {
      events.push('handler');
      return new Ok({ done: true });
    });

    expect(response.isSuccess).toBe(true);
    expect(events).toEqual(['pre1', 'pre2', 'handler', 'ok', 'finally']);
  });

  it('падение pre: следующие pre и хендлер не вызываются, ответная фаза получает Fail', async () => {
    const events: string[] = [];

    const pipeline = makePipeline()
      .pre(() => {
        events.push('pre1');
        return { a: 'a-value' };
      })
      .pre(() => {
        events.push('pre2');
        throw NoToken();
      })
      .pre(() => {
        events.push('pre3');
        return;
      })
      .ok(() => {
        events.push('ok');
        return;
      })
      .catch((error, ctx) => {
        events.push('catch');
        // Partial ctx: поле, добавленное ДО падения, доступно
        expect(ctx.input.a).toBe('a-value');
        expect(error.status).toBe('unauthorized');
        return;
      });

    const response = await run(pipeline, () => {
      events.push('handler');
      return new Ok({});
    });

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'unauthorized',
      value: { error: 'No token' },
    });
    expect(events).toEqual(['pre1', 'pre2', 'catch']);
  });

  it('catch может заменить ошибку; следующие юниты видят заменённый ответ', async () => {
    const seen: string[] = [];

    const pipeline = makePipeline()
      .pre(() => {})
      .catch((error) => {
        seen.push(`catch1:${error.status}`);
        // `.catch` может вернуть просто отказ. Рантайм нормализует его
        // так же, как отказ хендлера, и заодно делает недекларированный
        // internal_error объявленным.
        return Mapped();
      })
      .catch((error) => {
        seen.push(`catch2:${error.status}`);
        return;
      })
      .catch((error) => {
        seen.push(`catch3:${error.status}`);
        return;
      });

    const response = await run(pipeline, () => {
      throw new Error('boom');
    });

    expect(response).toMatchObject({
      status: 'bad_request',
      value: { error: 'mapped' },
    });
    expect(seen).toEqual([
      'catch1:internal_error',
      'catch2:bad_request',
      'catch3:bad_request',
    ]);
  });

  it('ok может заменить успех успехом', async () => {
    const pipeline = makePipeline()
      .pre(() => {})
      .ok((res) => ({
        ...res,
        value: { wrapped: res.value },
      }));

    const response = await run(pipeline, () => new Ok({ id: 1 }));

    expect(response).toMatchObject({
      isSuccess: true,
      value: { wrapped: { id: 1 } },
    });
  });

  it('падение ответного юнита заменяет ответ по общей политике ошибок', async () => {
    const events: string[] = [];

    const pipeline = makePipeline()
      .pre(() => {})
      .ok(() => {
        events.push('ok');
        throw new Error('audit db is down');
      })
      .catch((error) => {
        // Ответ стал ошибкой — catch, объявленный позже, применяется
        events.push('catch');
        expect(error.value.error).toBe('Internal server error');
        return;
      });

    const response = await run(pipeline, () => new Ok({}));

    expect(response.isSuccess).toBe(false);
    expect(response.value).toEqual({
      error: 'Internal server error',
      code: 'internal_error',
    });
    expect(JSON.stringify(response.value)).not.toContain('audit db');
    expect(events).toEqual(['ok', 'catch']);
  });

  it('применимость считается по текущему ответу: ok бросил — catch ниже применим', async () => {
    const events: string[] = [];

    const pipeline = makePipeline()
      .pre(() => {})
      .ok(() => {
        events.push('ok');
        throw Rejected();
      })
      .catch((error) => {
        events.push(`catch:${error.status}`);
        return;
      });

    const response = await run(pipeline, () => {
      events.push('handler');
      return new Ok({ id: 1 });
    });

    // Хендлер вернул успех, но ответ стал ошибкой в ответной фазе —
    // объявленный ниже catch применим к текущему ответу.
    expect(response).toMatchObject({
      isSuccess: false,
      status: 'bad_request',
    });
    expect(events).toEqual(['handler', 'ok', 'catch:bad_request']);
  });

  it('.ok(u).catch(u) с бросающим u вызывает его дважды (нюанс миграции с .after)', async () => {
    let calls = 0;

    // Миграция `.after(u)` → `.ok(u).catch(u)` эквивалентна, пока `u`
    // не бросает: бросок в роли ok-юнита делает ответ ошибкой, и тот же
    // `u` становится применим уже как catch-юнит.
    const u = (): never => {
      calls += 1;
      throw Rejected();
    };

    const pipeline = makePipeline()
      .pre(() => {})
      .ok(u)
      .catch(u);

    const response = await run(pipeline, () => new Ok({ id: 1 }));

    expect(calls).toBe(2);
    expect(response).toMatchObject({
      isSuccess: false,
      status: 'bad_request',
    });
  });
});

describe('Pipeline v2 — слои и compose', () => {
  it('pre снаружи внутрь, ответные и finally изнутри наружу', async () => {
    const events: string[] = [];

    const base = makePipeline()
      .pre(() => {
        events.push('pre:base');
        return;
      })
      .ok(() => {
        events.push('ok:base');
        return;
      })
      .finally(() => {
        events.push('finally:base');
      });

    const inner = makePipeline()
      .pre(() => {
        events.push('pre:inner');
        return;
      })
      .ok(() => {
        events.push('ok:inner');
        return;
      })
      .finally(() => {
        events.push('finally:inner');
      });

    const response = await run(compose(base, inner), () => {
      events.push('handler');
      return new Ok({});
    });

    expect(response.isSuccess).toBe(true);
    expect(events).toEqual([
      'pre:base',
      'pre:inner',
      'handler',
      'ok:inner',
      'ok:base',
      'finally:inner',
      'finally:base',
    ]);
  });

  it('ответ-ошибка: catch изнутри наружу, ok-юниты слоёв не исполняются', async () => {
    const events: string[] = [];

    const base = makePipeline()
      .pre(() => {})
      .ok(() => {
        events.push('ok:base');
        return;
      })
      .catch(() => {
        events.push('catch:base');
        return;
      })
      .finally(() => {
        events.push('finally:base');
      });

    const inner = makePipeline()
      .pre(() => {})
      .ok(() => {
        events.push('ok:inner');
        return;
      })
      .catch(() => {
        events.push('catch:inner');
        return;
      })
      .finally(() => {
        events.push('finally:inner');
      });

    const response = await run(compose(base, inner), failingHandler);

    expect(response.isSuccess).toBe(false);
    expect(events).toEqual([
      'catch:inner',
      'catch:base',
      'finally:inner',
      'finally:base',
    ]);
  });

  it('падение pre внешнего слоя: внутренний слой не исполняется вовсе', async () => {
    const events: string[] = [];

    const base = makePipeline()
      .pre(() => {
        events.push('pre:base');
        throw Forbidden();
      })
      .catch(() => {
        events.push('catch:base');
        return;
      })
      .finally(() => {
        events.push('finally:base');
      });

    const inner = makePipeline()
      .pre(() => {
        events.push('pre:inner');
        return;
      })
      .catch(() => {
        events.push('catch:inner');
        return;
      })
      .finally(() => {
        events.push('finally:inner');
      });

    const response = await run(compose(base, inner), () => {
      events.push('handler');
      return new Ok({});
    });

    expect(response).toMatchObject({ status: 'forbidden' });
    expect(events).toEqual(['pre:base', 'catch:base', 'finally:base']);
  });

  it('ответный юнит внутреннего слоя видит контекст внешнего полным', async () => {
    let seenRequestId: unknown;

    const base = makePipeline().pre(() => ({ requestId: 'r-42' }));

    const inner = makePipeline<{ requestId: string }>()
      .pre(() => {
        throw Rejected();
      })
      .catch((error, ctx) => {
        seenRequestId = ctx.input.requestId;
        return;
      });

    await run(compose(base, inner), () => new Ok({}));

    expect(seenRequestId).toBe('r-42');
  });
});

async function outcomeOf(opts: {
  signal?: AbortSignal;
  handler: LooseHandler;
}): Promise<{ outcome: string; response: unknown }> {
  let observed: { outcome: string; response: unknown } | undefined;

  const pipeline = makePipeline().finally((outcome, res) => {
    observed = { outcome, response: res };
  });

  await run(pipeline, opts.handler, { signal: opts.signal });

  if (!observed) {
    throw new Error('finally-юнит не был вызван');
  }
  return observed;
}

describe('Pipeline v2 — finally и исходы', () => {
  it('completed: успешный ответ без сигнала', async () => {
    const { outcome } = await outcomeOf({ handler: () => new Ok({}) });
    expect(outcome).toBe('completed');
  });

  it('failed: итоговый ответ — ошибка', async () => {
    const { outcome } = await outcomeOf({ handler: failingHandler });
    expect(outcome).toBe('failed');
  });

  it('disconnected: сигнал взведён причиной дисконнекта', async () => {
    const controller = new AbortController();
    const { outcome } = await outcomeOf({
      signal: controller.signal,
      handler: () => {
        controller.abort(new ClientDisconnectedError());
        return new Ok({});
      },
    });
    expect(outcome).toBe('disconnected');
  });

  it('aborted: сигнал взведён иной причиной (shutdown)', async () => {
    const controller = new AbortController();
    const { outcome } = await outcomeOf({
      signal: controller.signal,
      handler: () => {
        controller.abort(new TransportClosingError());
        return new Ok({});
      },
    });
    expect(outcome).toBe('aborted');
  });

  it('finally видит итоговый (заменённый) ответ', async () => {
    let seenStatus: unknown;

    const pipeline = makePipeline()
      .pre(() => {})
      .catch(() => Mapped())
      .finally((_outcome, res) => {
        seenStatus = res.status;
      });

    await run(pipeline, () => {
      throw new Error('boom');
    });

    expect(seenStatus).toBe('bad_request');
  });

  it('finally видит уже нормализованный проверкой ответ и исход failed', async () => {
    let seen: { outcome: string; status: string; code: unknown } | undefined;

    const pipeline = makePipeline()
      .pre(() => {})
      // Отказ остаётся незадекларированным: проверка операции отказов
      // применяется после ответной фазы и до finally.
      .catch(() => {})
      .finally((outcome, res) => {
        seen = {
          outcome,
          status: res.status,
          code: (res.value as { code?: string }).code,
        };
      });

    await run(pipeline, failingHandler, { errors: [] });

    expect(seen).toEqual({
      outcome: 'failed',
      status: 'internal_error',
      code: 'internal_error',
    });
  });

  it('ошибка finally-юнита не влияет на ответ', async () => {
    const pipeline = makePipeline()
      .pre(() => {})
      .finally(() => {
        throw new Error('observer exploded');
      });

    const response = await run(pipeline, () => new Ok({ fine: true }));

    expect(response).toMatchObject({
      isSuccess: true,
      value: { fine: true },
    });
  });
});

describe('Pipeline v2 — формы юнитов и bind', () => {
  class WithTracing {
    constructor(private readonly traceId: string) {}

    handle(): { traceId: string } {
      return { traceId: this.traceId };
    }
  }

  it('инстанс-форма исполняется без bind', async () => {
    const pipeline = makePipeline().pre(new WithTracing('t-1'));

    const response = await run(pipeline, (_payload, meta) => ({
      traceId: meta.traceId,
    }));

    expect(response).toMatchObject({ value: { traceId: 't-1' } });
  });

  it('класс-форма без bind — ошибка выполнения', async () => {
    const pipeline = makePipeline().pre(WithTracing);

    await expect(run(pipeline, () => new Ok({}))).rejects.toThrow(
      /unresolved class units \(WithTracing\)/,
    );
  });

  it('bind резолвит класс-юнит и пайплайн исполняется', async () => {
    const resolved: unknown[] = [];

    const pipeline = makePipeline()
      .pre(WithTracing)
      .bind((ctor) => {
        resolved.push(ctor);
        return new WithTracing('t-2');
      });

    const response = await run(pipeline, (_payload, meta) => ({
      traceId: meta.traceId,
    }));

    expect(resolved).toEqual([WithTracing]);
    expect(response).toMatchObject({ value: { traceId: 't-2' } });
  });

  it('bind с резолвером без handle — понятная ошибка', () => {
    const pipeline = makePipeline().pre(WithTracing);

    expect(() => pipeline.bind(() => ({}))).toThrow(
      /Cannot bind pipeline unit WithTracing/,
    );
  });

  it('в composed pipeline нельзя добавлять юниты (рантайм-защита)', () => {
    const composed = compose(
      makePipeline().pre(() => {}),
      makePipeline().pre(() => {}),
    ) as unknown as { ok(unit: unknown): unknown };

    expect(() => composed.ok(() => {})).toThrow(
      /Cannot add units to a composed pipeline/,
    );
  });
});

describe('Pipeline v2 — meta.signal', () => {
  it('сигнал транспорта доходит до хендлера', async () => {
    const controller = new AbortController();

    const response = await run(
      makePipeline(),
      (_, meta) => ({ same: meta.signal === controller.signal }),
      { signal: controller.signal },
    );

    expect(response).toMatchObject({
      isSuccess: true,
      value: { same: true },
    });
  });

  it('без сигнала транспорта — never-aborted дефолт', async () => {
    const response = await run(makePipeline(), (_, meta) => ({
      isSignal: meta.signal instanceof AbortSignal,
      aborted: meta.signal.aborted,
    }));

    expect(response).toMatchObject({
      isSuccess: true,
      value: { isSignal: true, aborted: false },
    });
  });

  it('ctx.signal доступен юнитам всех фаз и совпадает с meta.signal', async () => {
    const controller = new AbortController();
    const seen: AbortSignal[] = [];

    const pipeline = makePipeline()
      .pre((ctx) => {
        seen.push(ctx.signal);
        return;
      })
      .finally((_outcome, _res, ctx) => {
        seen.push(ctx.signal);
      });

    const response = await run(
      pipeline,
      (_, meta) => ({ same: meta.signal === controller.signal }),
      { signal: controller.signal },
    );

    expect(seen).toEqual([controller.signal, controller.signal]);
    expect(response).toMatchObject({ value: { same: true } });
  });

  it('поле signal из pre-юнита перекрывается сигналом контекста', async () => {
    const controller = new AbortController();

    const overridingSignal = (() =>
      Promise.resolve({ signal: 'not-a-signal' })) as PreUnitFn<
      EmptyInput,
      Record<string, unknown>
    >;

    const response = await run(
      makePipeline().pre(overridingSignal),
      (_, meta) => ({ same: meta.signal === controller.signal }),
      { signal: controller.signal },
    );

    expect(response).toMatchObject({ value: { same: true } });
  });
});

describe('Pipeline v2 — политика раскрытия ошибок', () => {
  it('задекларированный Fail сохраняет message, code и details независимо от exposeErrorDetails', async () => {
    const withoutOpt = await run(makePipeline(), failingHandler);
    expect(withoutOpt).toEqual({
      isSuccess: false,
      status: 'bad_request',
      value: {
        error: 'Email already taken',
        code: 'bad_request:email_taken',
        details: { field: 'email' },
      },
    });

    const withOpt = await run(makePipeline(), failingHandler, {
      options: { exposeErrorDetails: true },
    });
    expect(withOpt.value).toEqual({
      error: 'Email already taken',
      code: 'bad_request:email_taken',
      details: { field: 'email' },
    });
  });

  it('незадекларированный Fail не раскрывается: generic-тело с кодом internal_error', async () => {
    const response = await run(makePipeline(), failingHandler, { errors: [] });

    expect(response).toEqual({
      isSuccess: false,
      status: 'internal_error',
      value: { error: 'Internal server error', code: 'internal_error' },
    });
    expect(JSON.stringify(response.value)).not.toContain('Email already taken');
  });

  it('не-Fail по умолчанию — generic без message и stack', async () => {
    const response = await run(makePipeline(), () => {
      throw new Error('db password invalid');
    });

    expect(response.isSuccess).toBe(false);
    expect(response.status).toBe('internal_error');
    expect(response.value).toEqual({
      error: 'Internal server error',
      code: 'internal_error',
    });
    expect(JSON.stringify(response.value)).not.toContain('db password');
    expect((response.value as { stack?: string }).stack).toBeUndefined();
  });

  it('не-Fail с exposeErrorDetails: true — message и stack раскрыты', async () => {
    const response = await run(
      makePipeline(),
      () => {
        throw new Error('boom');
      },
      { options: { exposeErrorDetails: true } },
    );

    expect(response.isSuccess).toBe(false);
    expect(response.status).toBe('internal_error');
    expect((response.value as { error: string }).error).toBe('boom');
    expect((response.value as { stack?: string }).stack).toContain('boom');
  });

  it('не-Error значение с раскрытием — Unknown error', async () => {
    const response = await run(
      makePipeline(),
      () => {
        throw 'string error';
      },
      { options: { exposeErrorDetails: true } },
    );

    expect((response.value as { error: string }).error).toBe('Unknown error');
  });
});

describe('Pipeline v2 — возврат Fail эквивалентен броску', () => {
  const trackingPipeline = (events: string[]) =>
    makePipeline()
      .pre(() => {})
      .ok(() => {
        events.push('ok');
        return;
      })
      .catch(() => {
        events.push('catch');
        return;
      });

  it('возвращённый Fail уходит на error-track, а не 200 OK', async () => {
    const events: string[] = [];

    const response = await run(trackingPipeline(events), () =>
      EmailTaken({ field: 'email' }),
    );

    expect(response).toEqual({
      isSuccess: false,
      status: 'bad_request',
      value: {
        error: 'Email already taken',
        code: 'bad_request:email_taken',
        details: { field: 'email' },
      },
    });
    // Инвариант «.ok видит только успех» держится на обоих путях
    expect(events).toEqual(['catch']);
  });

  it('возврат и бросок неразличимы для ответа', async () => {
    const returned = await run(makePipeline(), () =>
      EmailTaken({ field: 'email' }),
    );
    const thrown = await run(makePipeline(), failingHandler);

    expect(returned).toEqual(thrown);
  });

  it('отказ, пришедший данными (без прототипа), тоже уходит на error-track', async () => {
    const wire = JSON.parse(JSON.stringify(NoToken())) as unknown;

    const response = await run(makePipeline(), () => wire);

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'unauthorized',
      value: { code: 'unauthorized:no_token' },
    });
  });

  it('cause не попадает в тело ответа', async () => {
    const cause = new Error('connection refused');

    const response = await run(makePipeline(), () =>
      EmailTaken({ field: 'email' }, { cause }),
    );

    expect(JSON.stringify(response.value)).not.toContain('connection refused');
    expect(response.value).not.toHaveProperty('cause');
  });
});

describe('Pipeline v2 — проверка операции отказов', () => {
  it('незадекларированный доменный отказ нормализуется в internal_error/500', async () => {
    const OrderNotFound = makeFail('not_found:order_not_found', {
      message: 'Order not found',
    });

    const response = await run(
      makePipeline(),
      () => {
        throw OrderNotFound();
      },
      { errors: [EmailTaken] },
    );

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'internal_error',
      value: { error: 'Internal server error', code: 'internal_error' },
    });
  });

  it('анонимный Fail.* нормализуется: кода нет — значит не задекларирован', async () => {
    const response = await run(makePipeline(), () => {
      throw Fail.notFound('nope');
    });

    expect(response).toMatchObject({
      status: 'internal_error',
      value: { code: 'internal_error' },
    });
  });

  it('catch-юнит превращает недекларированный отказ в объявленный', async () => {
    const pipeline = makePipeline()
      .pre(() => {})
      .catch(() => Mapped());

    const response = await run(
      pipeline,
      () => {
        throw new Error('deep failure');
      },
      { errors: [Mapped] },
    );

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'bad_request',
      value: { error: 'mapped', code: 'bad_request:mapped' },
    });
  });

  it('kernel-код проходит проверку без объявления в errors:', async () => {
    const response = await run(
      makePipeline(),
      () => {
        throw BadRequest([{ message: 'name must be a string' }]);
      },
      { errors: [] },
    );

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'bad_request',
      value: {
        code: 'bad_request',
        details: [{ message: 'name must be a string' }],
      },
    });
  });

  it('timeout проходит проверку нетронутым, не становясь internal_error', async () => {
    const response = await run(
      makePipeline(),
      () => {
        throw Timeout();
      },
      { errors: [] },
    );

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'timeout',
      value: { code: 'timeout' },
    });
  });

  it('пайплайн без декларации: объявленными считаются только kernel-коды', async () => {
    const response = await run(makePipeline(), failingHandler, {
      errors: undefined,
      options: { onUnknownFail: () => {} },
    });

    // declaredErrors — дефолт makeCtx, поэтому здесь отказ объявлен.
    // Проверка «пустого множества» — соседний кейс с errors: []
    expect(response.status).toBe('bad_request');

    const undeclared = await run(makePipeline(), failingHandler, {
      errors: [],
    });
    expect(undeclared.status).toBe('internal_error');
  });

  it("хук получает оригинал и метаданные endpoint'а, тело их не содержит", async () => {
    const seen: { error: unknown; pattern: string }[] = [];
    const original = EmailTaken({ field: 'email' });

    const response = await run(
      makePipeline(),
      () => {
        throw original;
      },
      {
        errors: [],
        options: {
          onUnknownFail: (info) =>
            seen.push({ error: info.error, pattern: info.endpoint.pattern }),
        },
      },
    );

    expect(seen).toEqual([{ error: original, pattern: 'TEST /' }]);
    expect(JSON.stringify(response.value)).not.toContain('email');
  });

  it('без хука диагностика уходит в console.error, ответ не меняется', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await run(makePipeline(), failingHandler, {
        errors: [],
        // Заглушка run() снимается: проверяем именно дефолт рантайма
        options: { onUnknownFail: undefined },
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toContain('[nestling]');
      expect(response.status).toBe('internal_error');
    } finally {
      spy.mockRestore();
    }
  });
});
