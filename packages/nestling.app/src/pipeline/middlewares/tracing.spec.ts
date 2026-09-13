/**
 * Шаг `withTracing()`: продолжение трассы, её начало и снисходительность
 * к значению, пришедшему из-за границы доверия.
 *
 * Проверяется поверхность шага в изоляции от транспорта: источник
 * родителя — атрибуты кадра, и оба транспорта кладут их туда одинаково.
 */

import type { TraceContext } from '../core/index.js';
import { contextVar, Ok, Trace } from '../core/index.js';
import { declaresVar, makePipeline } from '../core/pipeline.js';
import type { ExtendableContext } from '../core/types/context.js';
import { makeEndpoint } from '../metadata/endpoint.js';
import type { PolicySubject } from '../metadata/policy.js';
import { everyEndpoint } from '../metadata/policy.js';

import { withTracing } from './tracing.js';

import { describe, expect, it } from '@jest/globals';
import { makeToken } from '@nestlingjs/container';

const PARENT_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT_SPAN = '00f067aa0ba902b7';

const contextWith = (
  attributes: Record<string, unknown>,
): ExtendableContext<never> =>
  ({
    raw: { transport: 'http', pattern: 'GET /users', payload: {}, attributes },
  }) as unknown as ExtendableContext<never>;

/** Исполняет шаг и отдаёт положенную им трассу */
const trace = async (
  attributes: Record<string, unknown>,
): Promise<TraceContext> => {
  const addition = (await withTracing()(contextWith(attributes))) as {
    trace: TraceContext;
  };

  return addition.trace;
};

const HttpTransport$ = makeToken('transport:http');

/** Субъект политики в той форме, в какой его отдаёт discovery */
const subject = (pattern: string, pipeline?: unknown): PolicySubject => ({
  endpoint: (makeEndpoint as (options: unknown) => never)({
    transport: HttpTransport$,
    pattern,
    handler: async () => new Ok({ ok: true }),
    ...(pipeline === undefined ? {} : { pipeline }),
  }),
  moduleName: 'module:test',
});

describe('withTracing — продолжение трассы', () => {
  it('продолжает трассу заголовка traceparent', async () => {
    const value = await trace({
      traceparent: `00-${PARENT_TRACE}-${PARENT_SPAN}-01`,
    });

    expect(value.traceId).toBe(PARENT_TRACE);
    expect(value.parentSpanId).toBe(PARENT_SPAN);
    expect(value.spanId).toMatch(/^[\da-f]{16}$/);
    expect(value.spanId).not.toBe(PARENT_SPAN);
    expect(value.sampled).toBe(true);
  });

  it('переносит снятый флаг sampled', async () => {
    const value = await trace({
      traceparent: `00-${PARENT_TRACE}-${PARENT_SPAN}-00`,
    });

    expect(value.sampled).toBe(false);
  });

  it('продолжает трассу, привезённую конвертом шины', async () => {
    const value = await trace({
      subject: 'users.create',
      trace: { traceId: PARENT_TRACE, spanId: PARENT_SPAN, sampled: true },
    });

    expect(value.traceId).toBe(PARENT_TRACE);
    expect(value.parentSpanId).toBe(PARENT_SPAN);
  });

  it('значение шины сильнее заголовка: оно уже трасса, а не её запись', async () => {
    const other = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const value = await trace({
      trace: { traceId: PARENT_TRACE, spanId: PARENT_SPAN, sampled: true },
      traceparent: `00-${other}-${PARENT_SPAN}-01`,
    });

    expect(value.traceId).toBe(PARENT_TRACE);
  });
});

describe('withTracing — начало трассы', () => {
  it('без входящего контекста начинает новую трассу', async () => {
    const value = await trace({});

    expect(value.traceId).toMatch(/^[\da-f]{32}$/);
    expect(value.parentSpanId).toBeUndefined();
    expect(value.sampled).toBe(true);
  });

  it('две новые трассы не совпадают', async () => {
    const [first, second] = [await trace({}), await trace({})];

    expect(first.traceId).not.toBe(second.traceId);
  });

  it.each([
    ['мусор', 'garbage'],
    ['неизвестная версия', `ff-${PARENT_TRACE}-${PARENT_SPAN}-01`],
    ['короткий traceId', `00-abcdef-${PARENT_SPAN}-01`],
    ['нулевой spanId', `00-${PARENT_TRACE}-0000000000000000-01`],
    ['лишнее поле', `00-${PARENT_TRACE}-${PARENT_SPAN}-01-extra`],
    ['не строка', 42],
  ])('непонятный traceparent (%s) не отказ', async (_case, value) => {
    const result = await trace({ traceparent: value });

    expect(result.traceId).toMatch(/^[\da-f]{32}$/);
    expect(result.traceId).not.toBe(PARENT_TRACE);
    expect(result.parentSpanId).toBeUndefined();
  });

  it('непонятное значение шины тоже игнорируется', async () => {
    const result = await trace({ trace: { traceId: 'nope' } });

    expect(result.traceId).not.toBe('nope');
    expect(result.parentSpanId).toBeUndefined();
  });
});

describe('withTracing — объявление переменной', () => {
  it('засчитывается политике hasVar(Trace)', () => {
    const layer = makePipeline().pre(withTracing());

    expect(declaresVar(layer, Trace)).toBe(true);
  });

  it('переменная-омоним политику не удовлетворяет', () => {
    const twin = contextVar<TraceContext>()('traceLike');

    expect(declaresVar(makePipeline().pre(withTracing()), twin)).toBe(false);
  });

  it('политика перечисляет endpoint без шага', () => {
    const policy = everyEndpoint().hasVar(Trace, 'trace');
    const traced = subject('GET /users', makePipeline().pre(withTracing()));
    const bare = subject('GET /health');

    expect(policy.check([traced])).toEqual([]);

    const [violation] = policy.check([traced, bare]);

    expect(violation.pattern).toBe('GET /health');
    expect(policy.describe()).toContain('trace');
  });
});
