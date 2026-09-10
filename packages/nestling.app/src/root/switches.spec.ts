/**
 * Формы корня, словарь `switches:` и аргумент сборки.
 *
 * Обе новые оси состава проверяются одним наблюдением: что попало в граф,
 * что попало в отчёт и какими ошибками падает то, что не сходится.
 */

import { Ok } from '../pipeline/index.js';
import type { Port } from '../ports/index.js';
import { implement } from '../ports/index.js';
import { wireApp } from '../testing/index.js';
import type { ITransport } from '../transport/index.js';
import { transportValue } from '../transport/index.js';

import { loggerProbe } from './__fixtures__/logger.js';
import {
  ALL_FORMS,
  testEndpoint,
  TestTransport$,
} from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { makeFeature, makePlugin } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import {
  Component,
  Handler,
  makeModule,
  makeSwitch,
  makeToken,
} from '@nestlingjs/container';
import { makeRequest } from '@nestlingjs/operations';
import { z } from 'zod';

const asTransport = (transport: ITransport = new MockTransport()) =>
  transportValue(TestTransport$('default'), transport, {
    capabilities: ALL_FORMS,
  });

const Storage = makeSwitch('storage', ['s3', 'local']);
const Metrics = makeSwitch('metrics');
const Debug = makeSwitch('debug', { default: 'off' });

@Component()
class S3Storage {}

@Component()
class LocalStorage {}

@Component()
class StorageMetrics {}

const ping = (path = '/ping') =>
  testEndpoint({
    method: 'GET',
    path,
    output: z.object({ ok: z.boolean() }),
    handler: async () => new Ok({ ok: true }),
  });

describe('формы корня', () => {
  it('плоская форма с провайдерами: endpoint и провайдеры несут метку app', async () => {
    const report = await makeApp({
      endpoints: [ping()],
      providers: [S3Storage],
      transports: [asTransport()],
    }).check();

    expect(report.endpoints).toEqual([
      expect.objectContaining({ pattern: 'GET /ping', module: 'app' }),
    ]);
    expect(report.features).toEqual([]);
  });

  it('плоская форма с модулями: узлы несут метки своих модулей', async () => {
    const storage = makeModule({
      name: 'module:storage',
      providers: [S3Storage],
    });

    const report = await makeApp({
      endpoints: [ping()],
      modules: [storage],
      transports: [asTransport()],
    }).check();

    expect(report.endpoints).toEqual([
      expect.objectContaining({ module: 'app' }),
    ]);
  });

  it('форма с фичами: endpoint несёт имя своей фичи', async () => {
    const Users = makeFeature({ name: 'users', endpoints: [ping('/users')] });

    const report = await makeApp({
      features: [Users],
      transports: [asTransport()],
    }).check();

    expect(report.features).toEqual(['users']);
    expect(report.endpoints).toEqual([
      expect.objectContaining({ module: 'users' }),
    ]);
  });

  it('endpoints рядом с features — ошибка с перечнем трёх форм', () => {
    const Users = makeFeature({ name: 'users', endpoints: [ping()] });

    expect(() =>
      // @ts-expect-error форма состава одна из трёх
      makeApp({ endpoints: [ping()], features: [Users] }),
    ).toThrow(/{ endpoints, providers\? }, { endpoints, modules\? } or/);
  });

  it('providers рядом с modules — ошибка с перечнем трёх форм', () => {
    expect(() =>
      makeApp({
        endpoints: [ping()],
        providers: [S3Storage],
        // @ts-expect-error форма состава одна из трёх
        modules: [makeModule({ name: 'module:x' })],
      }),
    ).toThrow(/describe the composition twice/);
  });

  it('providers без endpoints называет плагин как место общего провайдера', () => {
    const Users = makeFeature({ name: 'users', endpoints: [ping()] });

    expect(() =>
      // @ts-expect-error провайдеры корня живут рядом с endpoints
      makeApp({ features: [Users], providers: [S3Storage] }),
    ).toThrow(/declared by a plugin \(makePlugin\)/);
  });

  it('пустая сборка законна', async () => {
    await expect(makeApp({}).check()).resolves.toMatchObject({
      features: [],
      endpoints: [],
    });
  });
});

describe('словарь switches: корня', () => {
  it('два переключателя с одним именем — ошибка декларации', () => {
    const other = makeSwitch('storage', ['a', 'b']);

    expect(() => makeApp({ switches: [Storage, other] })).toThrow(
      /Two different switches are named 'storage'/,
    );
  });

  it('имена features и includeDeps заняты', () => {
    expect(() => makeApp({ switches: [makeSwitch('features')] })).toThrow(
      /already has a field with that name/,
    );
    expect(() => makeApp({ switches: [makeSwitch('includeDeps')] })).toThrow(
      /already has a field with that name/,
    );
  });

  it('не переключатель в switches: — ошибка типа', () => {
    expect(() =>
      // @ts-expect-error ожидается значение makeSwitch()
      makeApp({ switches: [{ name: 'storage' }] }),
    ).toThrow(/switches\[0] is not a switch/);
  });
});

describe('ветки состава на фазе ASSEMBLE', () => {
  const storageModule = makeModule({
    name: 'module:storage',
    providers: [
      Storage.pick({ s3: [S3Storage], local: [LocalStorage] }),
      Metrics.when(StorageMetrics),
    ],
  });

  const uploads = makeFeature({
    name: 'uploads',
    modules: [storageModule],
    endpoints: [ping('/upload'), Debug.when(ping('/dump'))],
  });

  const app = makeApp({
    features: [uploads],
    switches: [Storage, Metrics, Debug],
    transports: [asTransport()],
  });

  it('в графе провайдеры выбранной ветки и только они', async () => {
    const wired = await wireApp(app, {
      args: { storage: 's3', metrics: 'off' },
    });

    expect(wired.container.get(S3Storage)).toBeInstanceOf(S3Storage);
    expect(wired.container.get(LocalStorage)).toBeNull();
    expect(wired.container.get(StorageMetrics)).toBeNull();

    await wired.close();
  });

  it('невыбранная ветка не приводит endpoint', async () => {
    const off = await app.check({ storage: 's3', metrics: 'off' });
    const on = await app.check({ storage: 's3', metrics: 'off', debug: 'on' });

    expect(off.endpoints.map(({ pattern }) => pattern)).toEqual([
      'GET /upload',
    ]);
    expect(on.endpoints.map(({ pattern }) => pattern)).toEqual([
      'GET /upload',
      'GET /dump',
    ]);
  });

  it('ветка в транспортах корня поднимает второй экземпляр', async () => {
    const admin = transportValue(TestTransport$('admin'), new MockTransport(), {
      capabilities: ALL_FORMS,
    });

    const withBranch = makeApp({
      endpoints: [ping()],
      switches: [Debug],
      transports: [asTransport(), Debug.when(admin)],
    });

    const withAdmin = await withBranch.check({ debug: 'on' });
    const withoutAdmin = await withBranch.check();

    expect(withAdmin.transports).toEqual(['test', 'test:admin']);
    expect(withoutAdmin.transports).toEqual(['test']);
  });

  it('ветка в плагинах корня подключает плагин целиком', async () => {
    const metrics = makePlugin({
      name: '@acme/metrics',
      providers: [StorageMetrics],
      endpoints: [ping('/metrics')],
    });

    const withPlugin = makeApp({
      endpoints: [ping()],
      switches: [Metrics],
      transports: [asTransport()],
      plugins: [Metrics.when(metrics)],
    });

    const on = await withPlugin.check({ metrics: 'on' });
    const off = await withPlugin.check({ metrics: 'off' });

    expect(on.endpoints.map(({ pattern }) => pattern)).toEqual([
      'GET /ping',
      'GET /metrics',
    ]);
    expect(off.endpoints).toHaveLength(1);
  });

  it('замыкание по вызовам видит уже раскрытый состав', async () => {
    const ClaimQuota = makeRequest({
      name: 'switches.quotas.claim',
      input: z.object({ amount: z.number() }),
      output: z.object({ granted: z.number() }),
    });

    @Handler([ClaimQuota.caller])
    class DumpHandler {
      constructor(private readonly quotas: Port<typeof ClaimQuota>) {}

      async handle() {
        await this.quotas.call({ amount: 1 });

        return new Ok({ ok: true });
      }
    }

    const quotas = makeFeature({
      name: 'quotas',
      endpoints: [
        implement(ClaimQuota, { handler: async () => new Ok({ granted: 1 }) }),
      ],
    });

    const debug = makeFeature({
      name: 'debug',
      endpoints: [
        Debug.when(
          testEndpoint({
            method: 'GET',
            path: '/dump',
            output: z.object({ ok: z.boolean() }),
            handler: DumpHandler,
          }),
        ),
      ],
    });

    const withClosure = makeApp({
      features: [debug, quotas],
      switches: [Debug],
      transports: [asTransport()],
    });

    const dumping = await withClosure.check({
      features: 'debug',
      includeDeps: true,
      debug: 'on',
    });
    const quiet = await withClosure.check({
      features: 'debug',
      includeDeps: true,
      debug: 'off',
    });

    expect(dumping.features).toEqual(['debug', 'quotas']);
    expect(quiet.features).toEqual(['debug']);
  });
});

describe('ошибки аргумента сборки', () => {
  const app = makeApp({
    endpoints: [ping()],
    switches: [Storage, Debug],
    transports: [asTransport()],
  });

  it('значение не из словаря перечисляет допустимые', async () => {
    await expect(
      // @ts-expect-error 'gcs' не значение переключателя
      app.check({ storage: 'gcs' }),
    ).rejects.toThrow(/Allowed values: 's3', 'local'/);
  });

  it('значение без умолчания не передано — называет поле аргумента', async () => {
    await expect(app.check('all')).rejects.toThrow(
      /Switch 'storage' has no default/,
    );
  });

  it('опечатка в имени поля перечисляет известные поля', async () => {
    await expect(
      // @ts-expect-error перечень полей закрыт
      app.check({ storag: 's3' }),
    ).rejects.toThrow(/Known fields: 'features', 'includeDeps', 'storage'/);
  });

  it('pick на переключателе вне switches: называет поле корня', async () => {
    const rogue = makeSwitch('rogue', ['a', 'b']);
    const withRogue = makeApp({
      endpoints: [ping()],
      modules: [
        makeModule({
          name: 'module:rogue',
          providers: [rogue.pick({ a: [S3Storage], b: [] })],
        }),
      ],
      transports: [asTransport()],
    });

    await expect(withRogue.check()).rejects.toThrow(
      /Switch 'rogue' .* not declared in 'switches:'/s,
    );
  });

  it('строковая форма берёт умолчания', async () => {
    const defaults = makeApp({
      features: [makeFeature({ name: 'users', endpoints: [ping()] })],
      switches: [Debug],
      transports: [asTransport()],
    });

    const report = await defaults.check('all');

    expect(report.switches).toEqual({ debug: 'off' });
  });

  it('секция конфига подходит аргументом целиком', async () => {
    const withFeature = makeApp({
      features: [makeFeature({ name: 'users', endpoints: [ping()] })],
      switches: [Storage, Debug],
      transports: [asTransport()],
    });

    // Именно то, что вернул бы `load(RootConfig)`: поля названы как
    // переключатели
    const cfg: { features: string; storage: 's3' | 'local' } = {
      features: 'all',
      storage: 'local',
    };

    const report = await withFeature.check(cfg);

    expect(report.switches).toEqual({ storage: 'local', debug: 'off' });
  });
});

describe('выбор в отчёте и на старте', () => {
  it('отчёт называет значение каждого переключателя в порядке объявления', async () => {
    const report = await makeApp({
      endpoints: [ping()],
      switches: [Storage, Debug],
      transports: [asTransport()],
    }).check({ storage: 'local' });

    expect(Object.entries(report.switches)).toEqual([
      ['storage', 'local'],
      ['debug', 'off'],
    ]);
  });

  it('приложение без переключателей даёт пустое поле отчёта', async () => {
    const report = await makeApp({
      endpoints: [ping()],
      transports: [asTransport()],
    }).check();

    expect(report.switches).toEqual({});
  });

  it('строка старта печатает выбор рядом с фичами', async () => {
    const probe = loggerProbe();

    const app = makeApp({
      endpoints: [ping()],
      switches: [Storage, Debug],
      transports: [asTransport()],
      logger: probe.logger,
    }).assemble({ storage: 's3' });

    await app.run();

    expect(probe.entries.map(({ message }) => message)).toContain(
      'features: (none); storage=s3 debug=off; transports: test',
    );

    await app.close();
  });

  it('строка старта без переключателей прежнего вида', async () => {
    const probe = loggerProbe();

    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport()],
      logger: probe.logger,
    }).assemble();

    await app.run();

    expect(probe.entries.map(({ message }) => message)).toContain(
      'features: (none); transports: test',
    );

    await app.close();
  });
});

describe('контейнер получает значения от сборки', () => {
  it('модуль с веткой собирается через корень без опции билдера', async () => {
    const Token$ = makeToken<string>('SwitchesProbe');

    const report = await makeApp({
      endpoints: [ping()],
      modules: [
        makeModule({
          name: 'module:branchy',
          providers: [
            Storage.pick({
              s3: [{ provide: Token$, useValue: 's3' }],
              local: [{ provide: Token$, useValue: 'local' }],
            }),
          ],
        }),
      ],
      switches: [Storage],
      transports: [asTransport()],
    }).check({ storage: 'local' });

    expect(report.switches).toEqual({ storage: 'local' });
  });
});
