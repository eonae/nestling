/**
 * Отказ, объявленный слоем, на пути через собранное приложение.
 *
 * Проверяется весь путь: декларация складывает эффективное множество,
 * транспорт переносит его в `EndpointMeta`, граница пропускает отказ со
 * своим кодом. Endpoint при этом не перечисляет отказ в `errors:`.
 */

import { SpyTransport } from './__fixtures__/transport.js';
import { assembleTest } from './app.js';

import { describe, expect, it } from '@jest/globals';
import { makeApp, makeFeature } from '@nestling/app';
import { makeFail, makePipeline, Ok } from '@nestling/pipeline';
import { transportValue } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

const Unauthorized = makeFail('unauthorized', { message: 'No token' });

const authed = makePipeline().pre(
  (ctx) => (ctx.raw.attributes.token ? { caller: 'u-1' } : Unauthorized()),
  { errors: [Unauthorized] },
);

const Profile = httpEndpoint({
  method: 'GET',
  path: '/profile',
  output: z.object({ caller: z.string() }),
  pipeline: authed,
  handler: async (_payload, meta) => new Ok({ caller: meta.caller }),
});

const makeAppUnderTest = () =>
  makeApp({
    features: [
      makeFeature({ name: 'module:layer-fails', endpoints: [Profile] }),
    ],
    transports: [transportValue(HttpTransport$('default'), new SpyTransport())],
  });

describe('отказ слоя в собранном приложении', () => {
  it('доезжает до ответа со своим кодом без объявления на декларации', async () => {
    await using test = await assembleTest(makeAppUnderTest());

    const response = await test.call(Profile, undefined, { attributes: {} });

    expect(response.isSuccess).toBe(false);
    expect(response.value).toMatchObject({ code: 'unauthorized' });
  });

  it('успешный проход отдаёт значение хендлера', async () => {
    await using test = await assembleTest(makeAppUnderTest());

    const response = await test.call(Profile, undefined, {
      attributes: { token: 't' },
    });

    expect(response.isSuccess).toBe(true);
    expect(response.value).toEqual({ caller: 'u-1' });
  });
});
