/**
 * Участок трассы: идентификаторы, родитель и имя.
 *
 * Идентификаторы участка берутся из переменной `Trace` ядра — той самой,
 * которую `withTracing()` увозит соседу заголовком `traceparent`.
 */

import { CollectedSpans } from './__fixtures__/exporters.js';
import { testTransport, TestTransport$ } from './__fixtures__/transport.js';
import { otel } from './otel.js';

import type { TraceContext } from '@nestlingjs/app';
import {
  compose,
  DEFAULT_INSTANCE,
  makeApp,
  makeEndpoint,
  makeFeature,
  makePipeline,
  Ok,
  withTracing,
} from '@nestlingjs/app';
import { buildTest } from '@nestlingjs/testing';
import { describe, expect, it } from 'vitest';

/** Трасса запроса, какой её увидел хендлер */
let seen: TraceContext | undefined;

const traces = new CollectedSpans();

const telemetry = otel({ service: 'users', version: '1.2.3', traces });

const observability = compose(
  makePipeline().pre(withTracing()),
  telemetry.spans,
);

const GetUser = makeEndpoint({
  transport: TestTransport$(DEFAULT_INSTANCE),
  pattern: 'GET /users/:id',
  output: 'text',
  pipeline: observability,
  handler: async (_payload: unknown, meta) => {
    seen = meta.trace;

    return new Ok('ann');
  },
});

const Users = makeFeature({ name: 'users', endpoints: [GetUser] });

const app = makeApp({
  features: [Users],
  plugins: [telemetry.plugin],
  transports: [testTransport()],
});

/** Строка W3C родительской трассы */
const traceparent = (traceId: string, spanId: string, flags = '01'): string =>
  `00-${traceId}-${spanId}-${flags}`;

describe('участок трассы', () => {
  it('идентификаторы равны значениям переменной `Trace`', async () => {
    traces.spans.length = 0;
    await using testApp = await buildTest(app);

    await testApp.call(GetUser);

    const span = traces.only();

    expect(span.spanContext().traceId).toBe(seen?.traceId);
    expect(span.spanContext().spanId).toBe(seen?.spanId);
  });

  it('родителем назван участок из заголовка', async () => {
    traces.spans.length = 0;
    await using testApp = await buildTest(app);

    const parentTrace = 'a'.repeat(32);
    const parentSpan = 'b'.repeat(16);

    await testApp.call(GetUser, undefined, {
      attributes: { traceparent: traceparent(parentTrace, parentSpan) },
    });

    const span = traces.only();

    expect(span.spanContext().traceId).toBe(parentTrace);
    expect(span.parentSpanContext?.spanId).toBe(parentSpan);
  });

  it('невыбранная трасса помечена флагом', async () => {
    traces.spans.length = 0;
    await using testApp = await buildTest(app);

    await testApp.call(GetUser, undefined, {
      attributes: {
        traceparent: traceparent('c'.repeat(32), 'd'.repeat(16), '00'),
      },
    });

    expect(traces.only().spanContext().traceFlags).toBe(0);
  });

  it('имя участка — шаблон маршрута, а не адрес запроса', async () => {
    traces.spans.length = 0;
    await using testApp = await buildTest(app);

    await testApp.call(GetUser);

    expect(traces.only().name).toBe('GET /users/:id');
  });

  it('атрибуты участка — те же, что у метрик ядра', async () => {
    traces.spans.length = 0;
    await using testApp = await buildTest(app);

    await testApp.call(GetUser);

    expect(traces.only().attributes).toMatchObject({
      transport: 'test',
      pattern: 'GET /users/:id',
      outcome: 'completed',
    });
  });

  it('ресурс участка несёт имя и версию сервиса', async () => {
    traces.spans.length = 0;
    await using testApp = await buildTest(app);

    await testApp.call(GetUser);

    expect(traces.only().resource.attributes).toMatchObject({
      'service.name': 'users',
      'service.version': '1.2.3',
    });
  });
});
