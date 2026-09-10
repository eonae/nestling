/**
 * `app.discover(args)` — публичный вход в discovery.
 *
 * Проверяется то, ради чего метод заведён: состав считается по аргументу
 * сборки, до графа и до источников конфига, и совпадает с составом,
 * который даёт `check()` при том же аргументе.
 */

import type { ConfigSource } from '../config/index.js';
import { Ok } from '../pipeline/index.js';
import { transportValue } from '../transport/index.js';

import {
  ALL_FORMS,
  testEndpoint,
  TestTransport$,
} from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { makeFeature, makePlugin } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import { Component, makeSwitch, makeToken } from '@nestlingjs/container';
import { z } from 'zod';

const Docs = makeSwitch('docs', { default: 'on' });

const ping = (path: string) =>
  testEndpoint({
    method: 'GET',
    path,
    output: z.object({ ok: z.boolean() }),
    handler: async () => new Ok({ ok: true }),
  });

const UsersFeature = makeFeature({
  name: 'users',
  endpoints: [ping('/users')],
});

const BillingFeature = makeFeature({
  name: 'billing',
  endpoints: [ping('/invoices')],
});

const DocsPlugin = makePlugin({
  name: 'docs',
  endpoints: [ping('/openapi.json')],
});

/** Источник, который падает на подъёме: фаза 0 сборки его поднимает */
const failing: ConfigSource = {
  name: 'vault',
  init: () => {
    throw new Error('connection refused');
  },
  // eslint-disable-next-line unicorn/no-useless-undefined
  get: () => undefined,
};

const makeTestApp = () =>
  makeApp({
    features: [UsersFeature, BillingFeature],
    plugins: [Docs.when(DocsPlugin)],
    switches: [Docs],
    transports: [
      transportValue(TestTransport$('default'), new MockTransport(), {
        capabilities: ALL_FORMS,
      }),
    ],
    config: [[failing, '*']],
  });

/** Паттерн и объявившая единица — то, чем составы сравниваются */
const attribution = (
  endpoints: readonly { endpoint: { pattern: string }; moduleName: string }[],
) =>
  endpoints
    .map(({ endpoint, moduleName }) => `${endpoint.pattern} @ ${moduleName}`)
    .sort();

describe('App.discover', () => {
  it('выбор фич отражён в результате', () => {
    const { endpoints } = makeTestApp().discover({ features: 'users' });

    expect(attribution(endpoints)).toEqual([
      'GET /openapi.json @ docs',
      'GET /users @ users',
    ]);
  });

  it('невыбранная ветка переключателя endpoint не даёт', () => {
    const { endpoints } = makeTestApp().discover({ docs: 'off' });

    expect(attribution(endpoints)).toEqual([
      'GET /invoices @ billing',
      'GET /users @ users',
    ]);
  });

  it('источники конфига не поднимаются: падающий источник не мешает', () => {
    // Тот же источник роняет `run()` и `check()` — фаза 0 сборки его
    // поднимает, а `discover()` до него не доходит
    expect(() => makeTestApp().discover()).not.toThrow();
  });

  it('карта транспортов группирует endpointʼы по DI-токену', () => {
    const { transports } = makeTestApp().discover({ features: 'billing' });

    expect([...transports.keys()]).toEqual([TestTransport$('default')]);
    expect(transports.get(TestTransport$('default'))).toHaveLength(2);
  });

  it('опечатка в имени фичи бросает ошибку фазы 0', () => {
    expect(() => makeTestApp().discover({ features: 'userz' })).toThrow(
      /Unknown feature 'userz'.*users, billing/s,
    );
  });

  it('неудовлетворённая зависимость методу не мешает', async () => {
    const Missing$ = makeToken<string>('discover:missing');

    @Component([Missing$])
    class NeedsMissing {
      constructor(readonly value: string) {}
    }

    const app = makeApp({
      endpoints: [ping('/ping')],
      providers: [NeedsMissing],
      transports: [
        transportValue(TestTransport$('default'), new MockTransport(), {
          capabilities: ALL_FORMS,
        }),
      ],
    });

    expect(attribution(app.discover().endpoints)).toEqual(['GET /ping @ app']);

    // Про этот DI-токен отвечает граф, а граф строит `check()`
    await expect(app.check()).rejects.toThrow(/discover:missing/);
  });
});

describe('составы `discover()` и `check()` совпадают', () => {
  const cases = [
    undefined,
    { features: 'users' },
    { docs: 'off' as const },
  ] as const;

  for (const args of cases) {
    const title = args === undefined ? 'без аргумента' : JSON.stringify(args);

    it(`${title}`, async () => {
      const app = makeApp({
        features: [UsersFeature, BillingFeature],
        plugins: [Docs.when(DocsPlugin)],
        switches: [Docs],
        transports: [
          transportValue(TestTransport$('default'), new MockTransport(), {
            capabilities: ALL_FORMS,
          }),
        ],
      });

      const discovered = app.discover(args);
      const report = await app.check(args);

      expect(attribution(discovered.endpoints)).toEqual(
        report.endpoints
          .map(({ pattern, module }) => `${pattern} @ ${module}`)
          .sort(),
      );
    });
  }
});
