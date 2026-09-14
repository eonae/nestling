/**
 * Обогащение участка из кода приложения.
 *
 * Сервис дописывает атрибут через `Ctx(Span)` и про OpenTelemetry SDK не
 * знает. Вне запроса читалка возвращает `undefined`: пайплайна у
 * `@OnStart` нет, и обязательным значение сделать нельзя.
 */

import { CollectedSpans } from './__fixtures__/exporters.js';
import { testTransport, TestTransport$ } from './__fixtures__/transport.js';
import { otel } from './otel.js';
import type { OtelSpan } from './span.js';
import { Span } from './span.js';

import type { CtxReader } from '@nestlingjs/app';
import {
  compose,
  Ctx,
  DEFAULT_INSTANCE,
  makeApp,
  makeEndpoint,
  makeFeature,
  makePipeline,
  Ok,
  withTracing,
} from '@nestlingjs/app';
import { Component, Handler } from '@nestlingjs/container';
import { buildTest } from '@nestlingjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

const traces = new CollectedSpans();

const telemetry = otel({ service: 'users', traces });

const observability = compose(
  makePipeline().pre(withTracing()),
  telemetry.spans,
);

/** Сервис, который дописывает атрибут на текущем участке */
@Component([Ctx(Span)])
class UsersService {
  constructor(private readonly span: CtxReader<OtelSpan>) {}

  find(id: string): string {
    this.span.peek()?.setAttribute('user.id', id);

    return 'ann';
  }
}

@Handler([UsersService])
class GetUserHandler {
  constructor(private readonly users: UsersService) {}

  async handle() {
    return new Ok(this.users.find('42'));
  }
}

const GetUser = makeEndpoint({
  transport: TestTransport$(DEFAULT_INSTANCE),
  pattern: 'GET /users/:id',
  output: 'text',
  pipeline: observability,
  handler: GetUserHandler,
});

const app = makeApp({
  features: [
    makeFeature({
      name: 'users',
      providers: [UsersService],
      endpoints: [GetUser],
    }),
  ],
  plugins: [telemetry.plugin],
  transports: [testTransport()],
});

beforeEach(() => {
  traces.spans.length = 0;
});

describe('переменная `Span`', () => {
  it('даёт сервису дописать атрибут', async () => {
    await using testApp = await buildTest(app);

    await testApp.call(GetUser);

    expect(traces.only().attributes['user.id']).toBe('42');
  });

  it('вне запроса читалка возвращает `undefined`', async () => {
    await using testApp = await buildTest(app);

    const reader = testApp.get(Ctx(Span));

    expect(reader?.peek()).toBeUndefined();
  });
});
