/**
 * Трасса примера: участок пишет слой сателлита.
 *
 * Проверяется то, ради чего сателлит в примере вообще есть: слой
 * наблюдаемости приложения ставит участок на каждый запрос, а пришедшая
 * трасса продолжается — участки двух процессов сходятся в одно дерево.
 *
 * Приложение здесь минимальное: базы ему не нужно, а слой — тот же
 * самый, что у фич.
 */

import { traced, traces } from './base.js';

import { makeApp, makeFeature, Ok } from '@nestlingjs/app';
import { buildTest } from '@nestlingjs/testing';
import { http, httpEndpoint } from '@nestlingjs/transport.http';
import type { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { beforeEach, describe, expect, it } from 'vitest';

/** Участки прогона: без адреса коллектора экспортёр копит их в памяти */
const memory = traces as InMemorySpanExporter;

const Ping = httpEndpoint.get('/ping', {
  output: 'text',
  pipeline: traced,
  handler: async () => new Ok('pong'),
});

const probe = makeApp({
  features: [makeFeature({ name: 'probe', endpoints: [Ping] })],
  transports: [http()],
});

/** Конверт вызывателя: арендатор и трасса приходят из-за границы */
const envelope = (traceparent?: string) => ({
  attributes: { tenantId: 'acme', ...(traceparent ? { traceparent } : {}) },
});

beforeEach(() => {
  memory.reset();
});

describe('участок трассы в примере', () => {
  it('пишется на каждый запрос', async () => {
    await using testApp = await buildTest(probe);

    await testApp.call(Ping, undefined, envelope());

    const [span] = memory.getFinishedSpans();

    expect(span?.name).toBe('GET /ping');
    expect(span?.attributes.outcome).toBe('completed');
  });

  it('продолжает трассу вызывателя: два процесса дают одно дерево', async () => {
    await using first = await buildTest(probe);
    await using second = await buildTest(probe);

    await first.call(Ping, undefined, envelope());

    const caller = memory.getFinishedSpans()[0]?.spanContext();

    await second.call(
      Ping,
      undefined,
      envelope(`00-${caller?.traceId}-${caller?.spanId}-01`),
    );

    const callee = memory.getFinishedSpans()[1];

    expect(callee?.spanContext().traceId).toBe(caller?.traceId);
    expect(callee?.parentSpanContext?.spanId).toBe(caller?.spanId);
  });
});
