/**
 * Исход запроса в статусе участка.
 *
 * Четыре исхода дают три статуса: уход клиента остаётся `UNSET`, потому
 * что это не отказ сервиса. Сам исход остаётся атрибутом участка, поэтому
 * отбор по нему возможен.
 */

import { CollectedSpans } from './__fixtures__/exporters.js';
import { run } from './__fixtures__/run.js';
import { otel } from './otel.js';

import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  ClientDisconnectedError,
  compose,
  Fail,
  makePipeline,
  Ok,
  TransportClosingError,
  withTracing,
} from '@nestlingjs/app';
import { SpanStatusCode } from '@opentelemetry/api';

const traces = new CollectedSpans();

const spans = compose(
  makePipeline().pre(withTracing()),
  otel({ service: 'users', traces }).spans,
);

beforeEach(() => {
  traces.spans.length = 0;
});

describe('исход запроса становится статусом участка', () => {
  it('успех даёт `OK`', async () => {
    await run(spans, async () => new Ok('ann'));

    const span = traces.only();

    expect(span.status.code).toBe(SpanStatusCode.OK);
    expect(span.attributes.outcome).toBe('completed');
  });

  it('отказ красит участок в `ERROR`', async () => {
    await run(spans, async () => Fail.notFound('nope'));

    const span = traces.only();

    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes.outcome).toBe('failed');
  });

  it('отмена красит участок в `ERROR`', async () => {
    const controller = new AbortController();

    await run(
      spans,
      async () => {
        controller.abort(new TransportClosingError());

        return new Ok('ann');
      },
      controller.signal,
    );

    const span = traces.only();

    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes.outcome).toBe('aborted');
  });

  it('уход клиента оставляет статус `UNSET`', async () => {
    const controller = new AbortController();

    await run(
      spans,
      async () => {
        controller.abort(new ClientDisconnectedError());

        return new Ok('ann');
      },
      controller.signal,
    );

    const span = traces.only();

    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(span.attributes.outcome).toBe('disconnected');
  });
});
