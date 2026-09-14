/* eslint-disable @typescript-eslint/no-empty-function --
 * noop-шаги: политика проверяет происхождение слоя, а не его эффект */
/**
 * Инварианты в тестовом корне: `buildTest` и матрица топологий гоняют
 * те же политики, что бой.
 *
 * Тестовый прогон инварианты не ослабляет — приложение, которое не
 * собирается в проде, не должно собираться в тесте.
 */

import { HTTP_LIKE, SpyTransport } from './__fixtures__/transport.js';
import { buildTest } from './app.js';
import { checkTopologies } from './topologies.js';

import { describe, expect, it } from '@jest/globals';
import type { ITransport } from '@nestlingjs/app';
import {
  compose,
  everyEndpoint,
  makeApp,
  makeFeature,
  makePipeline,
  Ok,
  transportValue,
} from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';
import { httpEndpoint, HttpTransport$ } from '@nestlingjs/transport.http';
import { z } from 'zod';

const asHttpTransport = (transport: ITransport) =>
  transportValue(HttpTransport$('default'), transport, {
    capabilities: HTTP_LIKE,
  });

const observability = makePipeline().pre(() => {});
const authedBase = makePipeline().pre(() => {});

const hasAuth = () =>
  everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
    authedBase,
    'authedBase',
  );

const Authed = httpEndpoint.get('/me', {
  pipeline: compose(observability, authedBase),
  output: z.unknown(),
  handler: async () => new Ok({ id: '1' }),
});

const Unauthed = httpEndpoint.get('/admin/users', {
  pipeline: observability,
  output: z.unknown(),
  handler: async () => new Ok({ users: [] }),
});

describe('buildTest — инварианты', () => {
  it('нарушение отклоняет сборку тем же сообщением, что и в бою', async () => {
    const events: string[] = [];

    @Component([])
    class Connection {
      constructor() {
        events.push('init');
      }
    }

    await expect(
      buildTest(
        makeApp({
          features: [
            makeFeature({
              name: 'module:admin',
              providers: [Connection],
              endpoints: [Unauthed],
            }),
          ],
          transports: [asHttpTransport(new SpyTransport())],
          policies: [hasAuth()],
        }),
      ),
    ).rejects.toThrow(/build policies[\S\s]*GET \/admin\/users/);

    expect(events).toEqual([]);
  });

  it('приложение под соблюдёнными политиками собирается', async () => {
    await using app = await buildTest(
      makeApp({
        features: [
          makeFeature({ name: 'module:profile', endpoints: [Authed] }),
        ],
        transports: [asHttpTransport(new SpyTransport())],
        policies: [hasAuth()],
      }),
    );

    const response = await app.call(Authed);

    expect(response.isSuccess).toBe(true);
  });
});

describe('checkTopologies — инварианты по каждой топологии', () => {
  it('ловит нарушение, возникающее только в одной топологии, и называет её', async () => {
    const ProfileFeature = makeFeature({
      name: 'profile',
      endpoints: [Authed],
    });

    const AdminFeature = makeFeature({
      name: 'admin',
      endpoints: [Unauthed],
    });

    const app = makeApp({
      features: [ProfileFeature, AdminFeature],
      transports: [asHttpTransport(new SpyTransport())],
      policies: [hasAuth()],
    });

    // Топология 'profile' инвариант держит, 'admin' — нет
    await expect(
      checkTopologies(app, [{ features: 'profile' }, { features: 'admin' }]),
    ).rejects.toThrow(/args: {"features":"admin"}[\S\s]*GET \/admin\/users/);

    await expect(
      checkTopologies(app, [{ features: 'profile' }]),
    ).resolves.toHaveLength(1);
  });
});
