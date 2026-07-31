/**
 * `checkTopologies` — матрица `select`-топологий и перечень всех отказов.
 */

import { SpyTransport } from './__fixtures__/transport';
import { checkTopologies } from './topologies';

import { describe, expect, it } from '@jest/globals';
import { makeAppModule, makeFeature } from '@nestling/app';
import { Injectable, makeToken, valueProvider } from '@nestling/container';
import { Ok } from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';

const asHttpTransport = (transport: ITransport) =>
  valueProvider(HttpTransport$, transport);

const ILogger = makeToken<{ log(): void }>('TopologyLogger');

const LoggingFeature = makeFeature({
  name: 'logging',
  modules: [
    makeAppModule({
      name: 'module:logging',
      providers: [valueProvider(ILogger, { log: (): void => undefined })],
      exports: [ILogger],
    }),
  ],
});

describe('checkTopologies', () => {
  it('проверяет каждую топологию без сокетов и возвращает отчёты', async () => {
    const UsersFeature = makeFeature({
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
      dependsOn: [LoggingFeature],
    });

    const transport = new SpyTransport();

    const reports = await checkTopologies(
      {
        features: [UsersFeature, LoggingFeature],
        transports: [asHttpTransport(transport)],
      },
      ['all', 'users', 'logging'],
    );

    expect(reports.map(({ select }) => select)).toEqual([
      'all',
      'users',
      'logging',
    ]);
    expect(reports[1].report.features).toEqual(['users', 'logging']);
    expect(reports[2].report.endpoints).toEqual([]);
    expect(transport.serving).toBe(false);
  });

  it('называет все несобираемые топологии в одном сообщении', async () => {
    // Обе ручки требуют логгер, который приезжает только фичей `logging`,
    // и ни одна не объявила `dependsOn`: сами по себе они не собираются
    @Injectable([ILogger])
    class UsersHandler {
      constructor(private readonly logger: { log(): void }) {}

      async handle() {
        this.logger.log();
        return new Ok({});
      }
    }

    @Injectable([ILogger])
    class ReportsHandler {
      constructor(private readonly logger: { log(): void }) {}

      async handle() {
        this.logger.log();
        return new Ok({});
      }
    }

    const UsersFeature = makeFeature({
      name: 'users',
      modules: [
        makeAppModule({
          name: 'module:users-broken',
          providers: [UsersHandler],
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/users',
              handle: UsersHandler,
            }),
          ],
        }),
      ],
    });

    const ReportsFeature = makeFeature({
      name: 'reports',
      modules: [
        makeAppModule({
          name: 'module:reports-broken',
          providers: [ReportsHandler],
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/reports',
              handle: ReportsHandler,
            }),
          ],
        }),
      ],
    });

    const error = await checkTopologies(
      {
        features: [UsersFeature, ReportsFeature, LoggingFeature],
        transports: [asHttpTransport(new SpyTransport())],
      },
      ['all', 'users', 'reports'],
    ).catch((error_: Error) => error_);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      '2 of 3 topologies did not assemble',
    );
    expect((error as Error).message).toContain(`select: 'users'`);
    expect((error as Error).message).toContain(`select: 'reports'`);
    expect((error as Error).message).toContain('TopologyLogger');
  });
});
