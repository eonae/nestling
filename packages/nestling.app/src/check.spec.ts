/**
 * `App.check()` — структурный смок на фазах 0–1 и внутренний шов фаз 0–3.
 *
 * Оба режима проверяются одним и тем же наблюдением: что выполнилось, что
 * не выполнилось и какими ошибками падает то, что не сходится.
 */

import { assemble } from './app';
import { makeFeature } from './feature';
import { MockTransport } from './helpers';
import { makeAppModule } from './module';
import { wireApp } from './testing';

import { describe, expect, it, jest } from '@jest/globals';
import {
  Injectable,
  makeToken,
  OnDestroy,
  OnInit,
  OnStart,
  valueProvider,
} from '@nestling/container';
import { makeEndpoint, Ok } from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';

const asHttpTransport = (transport: ITransport) =>
  valueProvider(HttpTransport$, transport);

describe('App.check() — фазы 0–1', () => {
  it('строит граф, не выполняя @OnInit и не выходя в эфир', async () => {
    const events: string[] = [];

    @Injectable([])
    class Connection {
      constructor() {
        events.push('constructed');
      }

      @OnInit()
      open(): void {
        events.push('init');
      }

      @OnStart()
      go(): void {
        events.push('start');
      }

      @OnDestroy()
      close(): void {
        events.push('destroy');
      }
    }

    const transport = new MockTransport();
    const report = await assemble({
      modules: [
        makeAppModule({ name: 'module:resource', providers: [Connection] }),
      ],
      transports: [asHttpTransport(transport)],
    }).check();

    expect(events).toEqual(['constructed']);
    expect(transport.serving).toBe(false);
    expect(report.transports).toEqual(['http']);
  });

  it('падает той же ошибкой, что и run()', async () => {
    const CliTransport$ = makeToken<ITransport>('transport:cli');
    const Orphan = makeEndpoint({
      transport: CliTransport$,
      pattern: 'orphan',
      handle: async () => new Ok({}),
    });

    const spec = {
      modules: [makeAppModule({ name: 'module:cli', endpoints: [Orphan] })],
      transports: [asHttpTransport(new MockTransport())],
    };

    await expect(assemble(spec).check()).rejects.toThrow(
      /Transport 'cli'.*module:cli.*'transports:'/s,
    );
    await expect(assemble(spec).run()).rejects.toThrow(
      /Transport 'cli'.*module:cli.*'transports:'/s,
    );
  });

  it('называет выбранные фичи и обнаруженные ручки с транспортами', async () => {
    const Logging = makeFeature({
      name: 'logging',
      modules: [makeAppModule({ name: 'module:logging' })],
    });

    const Users = makeFeature({
      name: 'users',
      modules: [
        makeAppModule({
          name: 'module:users',
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/users',
              handle: async () => new Ok({}),
            }),
          ],
        }),
      ],
      dependsOn: [Logging],
    });

    const report = await assemble({
      features: [Users, Logging],
      select: 'users',
      transports: [asHttpTransport(new MockTransport())],
    }).check();

    expect(report.features).toEqual(['users', 'logging']);
    expect(report.endpoints).toEqual([
      { pattern: 'GET /users', transport: 'http', module: 'module:users' },
    ]);
  });

  it('не мешает последующему run() того же приложения', async () => {
    const inits: string[] = [];

    @Injectable([])
    class Service {
      @OnInit()
      open(): void {
        inits.push('init');
      }
    }

    const transport = new MockTransport();
    const app = assemble({
      modules: [
        makeAppModule({
          name: 'module:service',
          providers: [Service],
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/ping',
              handle: async () => new Ok({}),
            }),
          ],
        }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await app.check();
    expect(inits).toEqual([]);

    await app.run();

    expect(inits).toEqual(['init']);
    expect(transport.routes.map((route) => route.pattern)).toEqual([
      'GET /ping',
    ]);

    await app.close();
  });
});

describe('шов @nestling/app/testing — фазы 0–3', () => {
  it('доводит до WIRE и останавливается', async () => {
    const events: string[] = [];

    @Injectable([])
    class Service {
      @OnInit()
      open(): void {
        events.push('init');
      }

      @OnStart()
      go(): void {
        events.push('start');
      }
    }

    const Ping = httpEndpoint({
      method: 'GET',
      path: '/ping',
      handle: async () => new Ok({ pong: true }),
    });

    const transport = new MockTransport();
    const before = process.listenerCount('SIGTERM');
    const log = jest
      .spyOn(console, 'log')
      .mockImplementation((): void => undefined);

    try {
      const wired = await wireApp({
        modules: [
          makeAppModule({
            name: 'module:service',
            providers: [Service],
            endpoints: [Ping],
          }),
        ],
        transports: [asHttpTransport(transport)],
      });

      expect(events).toEqual(['init']);
      expect(transport.serving).toBe(false);
      expect(process.listenerCount('SIGTERM')).toBe(before);
      expect(log).not.toHaveBeenCalled();

      // Ручка адресуется идентичностью декларации, а не строкой паттерна
      const endpoint = wired.endpoints.get(Ping);
      expect(endpoint?.moduleName).toBe('module:service');
      expect(endpoint?.dispatch.routes.map((route) => route.pattern)).toEqual([
        'GET /ping',
      ]);

      await wired.close();
    } finally {
      log.mockRestore();
    }
  });

  it('проводит подстановку и отдаёт список выпавших узлов', async () => {
    const IPool = makeToken<{ query(): string }>('SeamPool');
    const IRepository = makeToken<{ find(): string }>('SeamRepository');

    @Injectable(IPool, [])
    class PgPool {
      query(): string {
        return 'real';
      }
    }

    @Injectable(IRepository, [IPool])
    class PgRepository {
      constructor(private readonly pool: { query(): string }) {}

      find(): string {
        return this.pool.query();
      }
    }

    const wired = await wireApp({
      modules: [
        makeAppModule({
          name: 'module:data',
          providers: [PgPool, PgRepository],
        }),
      ],
      overrides: [[IRepository, { find: () => 'fake' }]],
    });

    expect(wired.container.getOrThrow(IRepository).find()).toBe('fake');
    expect(wired.container.pruned).toEqual(['SeamPool']);

    await wired.close();
  });

  it('взводит общий сигнал и выполняет @OnDestroy на close()', async () => {
    const events: string[] = [];

    @Injectable([])
    class Service {
      @OnDestroy()
      stop(): void {
        events.push('destroy');
      }
    }

    const wired = await wireApp({
      modules: [
        makeAppModule({ name: 'module:service', providers: [Service] }),
      ],
    });

    wired.signal.addEventListener('abort', () => events.push('aborted'));

    await wired.close();
    await wired.close();

    expect(events).toEqual(['aborted', 'destroy']);
  });
});
