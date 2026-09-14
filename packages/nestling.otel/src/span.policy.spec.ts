/**
 * Политика сборки: слой участков есть у каждого endpoint'а.
 *
 * Объявление переменной слоем засчитывает предикат `hasVar`, поэтому
 * забытый слой отклоняет сборку, называя паттерн и модуль, а не пропадает
 * из трассы молча.
 */

import { CollectedSpans } from './__fixtures__/exporters.js';
import { testTransport, TestTransport$ } from './__fixtures__/transport.js';
import { otel } from './otel.js';
import { Span } from './span.js';

import { describe, expect, it } from '@jest/globals';
import type { AnyEndpointDefinition } from '@nestlingjs/app';
import {
  compose,
  DEFAULT_INSTANCE,
  everyEndpoint,
  makeApp,
  makeEndpoint,
  makeFeature,
  makePipeline,
  Ok,
  withTracing,
} from '@nestlingjs/app';
import { buildTest } from '@nestlingjs/testing';

const telemetry = otel({ service: 'users', traces: new CollectedSpans() });

const traced = makePipeline().pre(withTracing());

const observability = compose(traced, telemetry.spans);

/** Endpoint со слоем участков */
const GetUser = makeEndpoint({
  transport: TestTransport$(DEFAULT_INSTANCE),
  pattern: 'GET /users/:id',
  output: 'text',
  pipeline: observability,
  handler: async () => new Ok('ann'),
});

/** Endpoint без слоя: трасса есть, участка нет */
const ListUsers = makeEndpoint({
  transport: TestTransport$(DEFAULT_INSTANCE),
  pattern: 'GET /users',
  output: 'text',
  pipeline: traced,
  handler: async () => new Ok('ann,bob'),
});

/** Тот же endpoint, помеченный осознанным отказом */
const ListUsersDetached = makeEndpoint({
  transport: TestTransport$(DEFAULT_INSTANCE),
  pattern: 'GET /users',
  output: 'text',
  pipeline: traced,
  detached: 'служебная выдача: в трассе не нужна',
  handler: async () => new Ok('ann,bob'),
});

const appWith = (endpoints: AnyEndpointDefinition[]) =>
  makeApp({
    features: [makeFeature({ name: 'users', endpoints })],
    plugins: [telemetry.plugin],
    transports: [testTransport()],
    policies: [everyEndpoint().hasVar(Span, 'span')],
  });

describe('политика присутствия слоя', () => {
  it('пропускает сборку, где слой есть у каждого endpoint’а', async () => {
    await using testApp = await buildTest(appWith([GetUser]));

    expect(testApp.features).toEqual(['users']);
  });

  it('отклоняет сборку, называя паттерн и модуль', async () => {
    await expect(buildTest(appWith([GetUser, ListUsers]))).rejects.toThrow(
      /GET \/users.*users/s,
    );
  });

  it('осознанный отказ снимает проверку', async () => {
    await using testApp = await buildTest(
      appWith([GetUser, ListUsersDetached]),
    );

    expect(testApp.features).toEqual(['users']);
  });
});
