/**
 * Метрики обработки запроса: четыре исхода, источник атрибутов и цена
 * приложения, которое метрики не включало.
 *
 * Проверяется рантайм пайплайна напрямую: запись стоит там же, где
 * вычислен `outcome`, и от транспорта не зависит.
 */

import { spyLogger } from '../../logger/__fixtures__/spy.js';
import { spyMetrics } from '../../metrics/__fixtures__/spy.js';
import { KERNEL_METRICS } from '../../metrics/names.js';

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
    ...(output === undefined ? {} : { output }),
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
  const items: unknown[] = [];

  for await (const item of value as AsyncIterable<unknown>) {
    items.push(item);
  }
};

describe('метрики запроса — исходы', () => {
  it('успех даёт счётчик и длительность с одними атрибутами', async () => {
    const spy = spyMetrics();

    await run(makePipeline(), async () => new Ok({ ok: true }), {
      metrics: spy.metrics,
    });

    const attributes = {
      transport: 'http',
      pattern: PATTERN,
      outcome: 'completed',
    };

    expect(spy.records).toContainEqual({
      kind: 'counter',
      name: KERNEL_METRICS.requests,
      value: 1,
      attributes,
    });

    const duration = spy.records.find(
      ({ name }) => name === KERNEL_METRICS.requestDuration,
    );

    expect(duration).toMatchObject({ kind: 'histogram', attributes });
    expect(duration?.value).toBeGreaterThanOrEqual(0);
  });

  it('отказ учитывается отдельно', async () => {
    const spy = spyMetrics();

    // Логгер заглушён шпионом: незадекларированный отказ пишется в
    // `stderr`, а предмет проверки здесь — исход, а не диагностика
    await run(makePipeline(), async () => Fail.notFound('nope'), {
      metrics: spy.metrics,
      logger: spyLogger().logger,
    });

    expect(spy.records[0].attributes.outcome).toBe('failed');
  });

  it('разрыв соединения учитывается отдельно', async () => {
    const spy = spyMetrics();
    const controller = new AbortController();

    await run(
      makePipeline(),
      async () => {
        controller.abort(new ClientDisconnectedError());

        return new Ok({ ok: true });
      },
      { metrics: spy.metrics },
      controller.signal,
    );

    expect(spy.records[0].attributes.outcome).toBe('disconnected');
  });

  it('отмена учитывается отдельно', async () => {
    const spy = spyMetrics();
    const controller = new AbortController();

    await run(
      makePipeline(),
      async () => {
        controller.abort(new TransportClosingError());

        return new Ok({ ok: true });
      },
      { metrics: spy.metrics },
      controller.signal,
    );

    expect(spy.records[0].attributes.outcome).toBe('aborted');
  });
});

describe('метрики запроса — поток', () => {
  const Row = z.object({ id: z.string() });

  it('запись появляется после закрытия итератора', async () => {
    const spy = spyMetrics();
    const output = stream(Row);

    const response = (await run(
      makePipeline(),
      async () => new Ok(rows()),
      { metrics: spy.metrics },
      undefined,
      output,
    )) as { value: unknown };

    expect(spy.records).toEqual([]);

    await drain(response.value);

    expect(spy.records).toHaveLength(2);
    expect(spy.records[0].attributes.outcome).toBe('completed');
  });
});

describe('метрики запроса — цена выключенной наблюдаемости', () => {
  it('без опции metrics ни один метод не вызван', async () => {
    const spy = spyMetrics();

    await run(makePipeline(), async () => new Ok({ ok: true }), {});

    expect(spy.records).toEqual([]);
  });
});
