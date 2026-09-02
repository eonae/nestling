/**
 * `checkTopologies` — матрица `select`-топологий и перечень всех отказов.
 */

import { SpyTransport } from './__fixtures__/transport';
import { checkTopologies } from './topologies';

import { describe, expect, it } from '@jest/globals';
import { makeFeature, makePlugin } from '@nestling/app';
import { Injectable, makeToken, valueProvider } from '@nestling/container';
import { makeContract } from '@nestling/contracts';
import type { SchemaDocConverter } from '@nestling/pipeline';
import { Ok } from '@nestling/pipeline';
import {
  diffContracts,
  formatCompatibility,
  implement,
  snapshotContracts,
} from '@nestling/ports';
import type { ITransport } from '@nestling/transport';
import { transportValue } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

const asHttpTransport = (transport: ITransport) =>
  transportValue(HttpTransport$('default'), transport);

/** Конвертер-фикстура поверх штатного конвертера валидатора */
const zodConverter = (): SchemaDocConverter => ({
  vendor: 'zod',
  toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
});

const ILogger = makeToken<{ log(): void }>('TopologyLogger');

/**
 * Логирование — плагин: оно есть в каждом процессе, и к нему обращаются
 * токеном. В словарь `select` плагин не входит.
 */
const loggingPlugin = makePlugin({
  name: '@nestling/topology-logging',
  providers: [valueProvider(ILogger, { log: (): void => undefined })],
});

describe('checkTopologies', () => {
  it('проверяет каждую топологию без сокетов и возвращает отчёты', async () => {
    const UsersFeature = makeFeature({
      name: 'users',
      endpoints: [
        httpEndpoint({
          method: 'GET',
          path: '/users',
          handle: async () => new Ok({}),
        }),
      ],
    });

    const ReportsFeature = makeFeature({ name: 'reports', providers: [] });

    const transport = new SpyTransport();

    const reports = await checkTopologies(
      {
        features: [UsersFeature, ReportsFeature],
        plugins: [loggingPlugin],
        transports: [asHttpTransport(transport)],
      },
      ['all', 'users', 'reports'],
    );

    expect(reports.map(({ select }) => select)).toEqual([
      'all',
      'users',
      'reports',
    ]);
    expect(reports[1].report.features).toEqual(['users']);
    expect(reports[2].report.endpoints).toEqual([]);
    expect(transport.serving).toBe(false);
  });

  it('называет все несобираемые топологии в одном сообщении', async () => {
    // Оба endpoint'а требуют логгер, а плагин, который его поставляет,
    // в этой сборке не подключён: ни одна топология не собирается
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
      providers: [UsersHandler],
      endpoints: [
        httpEndpoint({ method: 'GET', path: '/users', handle: UsersHandler }),
      ],
    });

    const ReportsFeature = makeFeature({
      name: 'reports',
      providers: [ReportsHandler],
      endpoints: [
        httpEndpoint({
          method: 'GET',
          path: '/reports',
          handle: ReportsHandler,
        }),
      ],
    });

    const error = await checkTopologies(
      {
        features: [UsersFeature, ReportsFeature],
        transports: [asHttpTransport(new SpyTransport())],
      },
      ['all', 'users', 'reports'],
    ).catch((error_: Error) => error_);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      '3 of 3 topologies did not assemble',
    );
    expect((error as Error).message).toContain(`select: 'users'`);
    expect((error as Error).message).toContain(`select: 'reports'`);
    expect((error as Error).message).toContain('TopologyLogger');
  });
});

describe('checkTopologies — контракты и снапшот', () => {
  const ClaimQuota = makeContract({
    name: 'matrix.quotas.claim',
    kind: 'request',
    input: z.object({ email: z.string() }),
    output: z.object({ remaining: z.number() }),
  });

  const ListUsers = makeContract({
    name: 'matrix.users.list',
    kind: 'request',
    output: z.object({ total: z.number() }),
  });

  const QuotasFeature = makeFeature({
    name: 'quotas',
    endpoints: [
      implement(ClaimQuota, { handle: async () => new Ok({ remaining: 1 }) }),
    ],
  });

  const UsersFeature = makeFeature({
    name: 'users',
    endpoints: [
      implement(ListUsers, { handle: async () => new Ok({ total: 2 }) }),
    ],
  });

  const spec = () => ({
    features: [UsersFeature, QuotasFeature],
    transports: [asHttpTransport(new SpyTransport())],
  });

  it('прокидывает конвертеры в каждую топологию', async () => {
    const reports = await checkTopologies(spec(), ['all', 'users'], {
      converters: [zodConverter()],
    });

    for (const { report } of reports) {
      for (const descriptor of report.contracts) {
        expect(descriptor.output.leaf).toMatchObject({ leaf: 'schema' });
      }
    }
  });

  it('без опций листья непрозрачны, а поведение прежнее', async () => {
    const [{ report }] = await checkTopologies(spec(), ['all']);

    expect(report.contracts).toHaveLength(2);
    expect(report.contracts[0].output.leaf).toMatchObject({ leaf: 'opaque' });
  });

  it('снапшот собирается из отчётов матрицы без пересборки приложения', async () => {
    const reports = await checkTopologies(spec(), ['all', 'users'], {
      converters: [zodConverter()],
    });

    const snapshot = snapshotContracts(reports);

    expect(snapshot.contracts.map(({ name }) => name)).toEqual([
      'matrix.quotas.claim',
      'matrix.users.list',
    ]);

    // Контракт, публикуемый не всеми топологиями, в снапшоте есть — и
    // видно, какая топология его публикует
    expect(
      snapshot.contracts.find(({ name }) => name === 'matrix.quotas.claim')
        ?.topologies,
    ).toEqual(['all']);
    expect(
      snapshot.contracts.find(({ name }) => name === 'matrix.users.list')
        ?.topologies,
    ).toEqual(['all', 'users']);
  });

  it('дифф снапшота с самим собой не находит расхождений', async () => {
    const reports = await checkTopologies(spec(), ['all'], {
      converters: [zodConverter()],
    });
    const snapshot = snapshotContracts(reports);

    const report = diffContracts(snapshot, snapshot);

    expect(report.breaking).toEqual([]);
    expect(report.additive).toEqual([]);
    expect(report.unknown).toEqual([]);
    expect(formatCompatibility(report)).toContain('0 breaking');
  });
});
