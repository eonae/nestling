/* eslint-disable @typescript-eslint/no-empty-function --
 * noop-юниты: политика проверяет происхождение слоя, а не его эффект */
/**
 * Инварианты в тестовом корне: `assembleTest` и матрица топологий гоняют
 * те же политики, что бой.
 *
 * Тестовый прогон инварианты не ослабляет — приложение, которое не
 * собирается в проде, не должно собираться в тесте.
 */

import { SpyTransport } from './__fixtures__/transport';
import { assembleTest } from './app';
import { checkTopologies } from './topologies';

import { describe, expect, it } from '@jest/globals';
import { makeFeature } from '@nestling/app';
import { Injectable, OnInit } from '@nestling/container';
import { compose, everyEndpoint, makePipeline, Ok } from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';
import { transportValue } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';

const asHttpTransport = (transport: ITransport) =>
  transportValue(HttpTransport$('default'), transport);

const observability = makePipeline().pre(() => {});
const authedBase = makePipeline().pre(() => {});

const hasAuth = () =>
  everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
    authedBase,
    'authedBase',
  );

const Authed = httpEndpoint({
  method: 'GET',
  path: '/me',
  pipeline: compose(observability, authedBase),
  handle: async () => new Ok({ id: '1' }),
});

const Unauthed = httpEndpoint({
  method: 'GET',
  path: '/admin/users',
  pipeline: observability,
  handle: async () => new Ok({ users: [] }),
});

describe('assembleTest — инварианты', () => {
  it('нарушение отклоняет сборку тем же сообщением, что и в бою', async () => {
    const events: string[] = [];

    @Injectable([])
    class Connection {
      @OnInit()
      open(): void {
        events.push('init');
      }
    }

    await expect(
      assembleTest({
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
    ).rejects.toThrow(/assembly policies[\S\s]*GET \/admin\/users/);

    expect(events).toEqual([]);
  });

  it('приложение под соблюдёнными политиками собирается', async () => {
    await using app = await assembleTest({
      features: [makeFeature({ name: 'module:profile', endpoints: [Authed] })],
      transports: [asHttpTransport(new SpyTransport())],
      policies: [hasAuth()],
    });

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

    const spec = {
      features: [ProfileFeature, AdminFeature],
      transports: [asHttpTransport(new SpyTransport())],
      policies: [hasAuth()],
    };

    // Топология 'profile' инвариант держит, 'admin' — нет
    await expect(checkTopologies(spec, ['profile', 'admin'])).rejects.toThrow(
      /select: 'admin'[\S\s]*GET \/admin\/users/,
    );

    await expect(checkTopologies(spec, ['profile'])).resolves.toHaveLength(1);
  });
});
