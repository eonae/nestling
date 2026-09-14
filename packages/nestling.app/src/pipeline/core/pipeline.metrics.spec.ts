/**
 * Метрики обработки запроса: четыре исхода, источник атрибутов и нули до
 * первого запроса.
 *
 * Проверяется рантайм пайплайна напрямую: запись стоит там же, где
 * вычислен `outcome`, и от транспорта не зависит.
 */

import { spyLogger } from '../../logger/__fixtures__/spy.js';
import type { MetricsProbe } from '../../metrics/__fixtures__/probe.js';
import { probeMetrics } from '../../metrics/__fixtures__/probe.js';
import { KernelMetrics } from '../../metrics/index.js';

import type { EndpointMeta, ExtendableContext } from './types/context.js';
import { makeEmptyContext } from './types/context.js';
import type { Raw } from './types/raw.js';
import { ClientDisconnectedError, TransportClosingError } from './abort.js';
import type { AnyPipeline, ExecuteOptions, Pipeline } from './pipeline.js';
import { makePipeline } from './pipeline.js';

import { describe, expect, it } from '@jest/globals';
import type { AnyInput, EmptyInput } from '@nestlingjs/operations';
import { Fail, Ok, stream } from '@nestlingjs/operations';
import { z } from 'zod';

const PATTERN = 'GET /users/:id';

const { requests } = KernelMetrics.members;
const duration = KernelMetrics.members['request.duration'];

/** Проба с рядами одного endpoint'а — тем же, что исполняет спека */
const probe = (): MetricsProbe =>
  probeMetrics({ endpoints: [{ transport: 'http', pattern: PATTERN }] });

const ctxOf = (
  signal?: AbortSignal,
  output?: EndpointMeta['output'],
): ExtendableContext<EmptyInput> => {
  // Адрес запроса и шаблон маршрута различаются намеренно: атрибут
  // берётся из декларации, а не из кадра
  const raw: Raw = {
    transport: 'http',
    pattern: 'GET /users/42',
    payload: undefined,
    attributes: {},
  };

  const endpoint: EndpointMeta = {
    transport: 'http',
    pattern: PATTERN,
    output: output ?? z.unknown(),
  };

  return makeEmptyContext(raw, endpoint, signal);
};

/** Исполняет пайплайн с ослабленными типами, как это делают транспорты */
const run = (
  pipeline: AnyPipeline,
  handler: (payload: unknown, meta: Record<string, unknown>) => unknown,
  options: ExecuteOptions,
  signal?: AbortSignal,
  output?: EndpointMeta['output'],
): Promise<unknown> =>
  (
    pipeline as unknown as Pipeline<EmptyInput, AnyInput, never>
  ).executeWithHandler(handler, ctxOf(signal, output), options);

async function* rows(): AsyncIterableIterator<{ id: string }> {
  yield { id: 'a' };
  yield { id: 'b' };
}

/** Собирает поток целиком: предмет проверки — момент записи, не элементы */
const drain = async (value: unknown): Promise<void> => {
  for await (const item of value as AsyncIterable<unknown>) {
    void item;
  }
};

describe('метрики запроса — исходы', () => {
  it('успех даёт счётчик и длительность с одними атрибутами', async () => {
    const metrics = probe();

    await run(makePipeline(), async () => new Ok({ ok: true }), {
      metrics: metrics.kernel,
    });

    const attributes = {
      transport: 'http',
      pattern: PATTERN,
      outcome: 'completed',
    };

    expect(metrics.of(requests, attributes)).toMatchObject({
      kind: 'counter',
      value: 1,
    });

    expect(metrics.of(duration, attributes)).toMatchObject({
      kind: 'histogram',
      count: 1,
    });
  });

  it('отказ учитывается отдельно', async () => {
    const metrics = probe();

    // Логгер заглушён шпионом: незадекларированный отказ пишется в
    // `stderr`, а предмет проверки здесь — исход, а не диагностика
    await run(makePipeline(), async () => Fail.notFound('nope'), {
      metrics: metrics.kernel,
      logger: spyLogger().logger,
    });

    expect(metrics.of(requests, { outcome: 'failed' })).toMatchObject({
      value: 1,
    });
  });

  it('разрыв соединения учитывается отдельно', async () => {
    const metrics = probe();
    const controller = new AbortController();

    await run(
      makePipeline(),
      async () => {
        controller.abort(new ClientDisconnectedError());

        return new Ok({ ok: true });
      },
      { metrics: metrics.kernel },
      controller.signal,
    );

    expect(metrics.of(requests, { outcome: 'disconnected' })).toMatchObject({
      value: 1,
    });
  });

  it('отмена учитывается отдельно', async () => {
    const metrics = probe();
    const controller = new AbortController();

    await run(
      makePipeline(),
      async () => {
        controller.abort(new TransportClosingError());

        return new Ok({ ok: true });
      },
      { metrics: metrics.kernel },
      controller.signal,
    );

    expect(metrics.of(requests, { outcome: 'aborted' })).toMatchObject({
      value: 1,
    });
  });

  it('адрес запроса в атрибуты не попадает', async () => {
    const metrics = probe();

    await run(makePipeline(), async () => new Ok({ ok: true }), {
      metrics: metrics.kernel,
    });

    expect(metrics.all(requests, { pattern: 'GET /users/42' })).toEqual([]);
  });
});

describe('метрики запроса — поток', () => {
  const Row = z.object({ id: z.string() });

  it('запись появляется после закрытия итератора', async () => {
    const metrics = probe();
    const output = stream(Row);

    const response = (await run(
      makePipeline(),
      async () => new Ok(rows()),
      { metrics: metrics.kernel },
      undefined,
      output,
    )) as { value: unknown };

    expect(metrics.of(requests, { outcome: 'completed' })).toMatchObject({
      value: 0,
    });

    await drain(response.value);

    expect(metrics.of(requests, { outcome: 'completed' })).toMatchObject({
      value: 1,
    });
  });
});

describe('метрики запроса — ряды до первого запроса', () => {
  it('каждый исход endpoint’а есть в снимке со значением ноль', () => {
    const metrics = probe();

    expect(
      metrics.all(requests).map(({ attributes }) => attributes.outcome),
    ).toEqual(['completed', 'disconnected', 'aborted', 'failed']);

    expect(
      metrics
        .all(requests)
        .every((series) => series.kind === 'counter' && series.value === 0),
    ).toBe(true);
  });
});
