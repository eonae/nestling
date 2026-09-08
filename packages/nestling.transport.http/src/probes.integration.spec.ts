/**
 * Пробы HTTP: коды 200 и 503, тело отчёта, свои пути, отсутствие в
 * документе и независимость liveness от итога readiness.
 *
 * Тест поднимает настоящее приложение с настоящим сокетом: пробу зовёт
 * окружение по адресу, и проверять её иначе, чем запросом, нечего.
 */

import { request } from 'node:http';

import { httpServerKeys } from './config.js';
import { httpProbes } from './probes.js';
import type { HttpServer } from './server.js';
import { HttpTransport$ } from './token.js';
import { http } from './transport.js';

import type {
  AnyEndpointDefinition,
  AssembledApp,
  HealthCheck,
  HealthStatus,
} from '@nestling/app';
import {
  everyEndpoint,
  HealthCheck$,
  makeApp,
  makeFeature,
  makePipeline,
  objectSource,
} from '@nestling/app';
import { classProvider, Component, makeModule } from '@nestling/container';

/** Ответ пробы: код и тело — разобранное, если оно JSON */
interface Probe {
  readonly status: number;
  readonly body: any;
}

/** 404 отдаётся текстом, поэтому разбор не обязан удаваться */
const parse = (raw: string): unknown => {
  if (raw === '') {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

/** Исход, который вклад отдаёт следующей проверке */
let outcome: HealthStatus | Error = 'ok';

@Component([])
class DbCheck implements HealthCheck {
  readonly critical = true;

  async check(): Promise<HealthStatus> {
    if (outcome instanceof Error) {
      throw outcome;
    }

    return outcome;
  }
}

const DbModule = makeModule({
  name: 'module:db',
  providers: [classProvider(HealthCheck$('db'), DbCheck)],
});

/** Порт выбирает ОС, адрес — loopback: сокет теста никуда не смотрит */
const socket = objectSource(
  { HTTP_PORT: '0', HTTP_HOST: '127.0.0.1' },
  'test-socket',
);

/** Собирает приложение с пробами на эфемерном порту */
const start = async (
  plugin = httpProbes(),
): Promise<{ app: AssembledApp; port: number }> => {
  const app = makeApp({
    features: [makeFeature({ name: 'db', modules: [DbModule] })],
    plugins: [plugin],
    transports: [http()],
    config: [[socket, httpServerKeys()]],
  }).assemble();

  await app.run();

  // Порт назначает ОС, поэтому фактический адрес читается у сервера
  const server = app.servers.get('default') as HttpServer | undefined;
  const address = server?.address();

  if (!address) {
    throw new Error('server is not listening');
  }

  return { app, port: address.port };
};

/** Зовёт пробу и возвращает код с разобранным телом */
const call = (port: number, path: string): Promise<Probe> =>
  new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (raw += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: parse(raw),
          }),
        );
      },
    );

    req.on('error', reject);
    req.end();
  });

beforeEach(() => {
  outcome = 'ok';
});

describe('пробы HTTP', () => {
  it('готовое приложение отвечает 200 и отчётом', async () => {
    const { app, port } = await start();

    try {
      const ready = await call(port, '/readyz');

      expect(ready.status).toBe(200);
      expect(ready.body).toMatchObject({ status: 'ready', phase: 'RUN' });
      expect(ready.body.checks).toEqual([
        {
          name: 'db',
          critical: true,
          status: 'ok',
          durationMs: expect.any(Number),
        },
      ]);
    } finally {
      await app.close();
    }
  });

  it('liveness отвечает 200 независимо от итога readiness', async () => {
    outcome = 'down';
    const { app, port } = await start();

    try {
      const [alive, ready] = await Promise.all([
        call(port, '/healthz'),
        call(port, '/readyz'),
      ]);

      expect(alive).toEqual({ status: 200, body: { status: 'ok' } });
      expect(ready.status).toBe(503);
      expect(ready.body).toMatchObject({
        code: 'service_unavailable:not_ready',
      });
      expect(ready.body.details).toMatchObject({
        status: 'not_ready',
        phase: 'RUN',
      });
    } finally {
      await app.close();
    }
  });

  it('свои пути обслуживаются, умолчательные отвечают 404', async () => {
    const { app, port } = await start(
      httpProbes({ liveness: '/live', readiness: '/ready' }),
    );

    try {
      const [live, ready, healthz, readyz] = await Promise.all([
        call(port, '/live'),
        call(port, '/ready'),
        call(port, '/healthz'),
        call(port, '/readyz'),
      ]);

      expect([live.status, ready.status]).toEqual([200, 200]);
      expect([healthz.status, readyz.status]).toEqual([404, 404]);
    } finally {
      await app.close();
    }
  });

  it('политика на слой сборку не роняет, а причина видна в отчёте', async () => {
    // Слой, которого у проб нет и быть не может: они объявлены без
    // пайплайна вовсе
    const authed = makePipeline();

    const report = await makeApp({
      features: [makeFeature({ name: 'db', modules: [DbModule] })],
      plugins: [httpProbes()],
      transports: [http()],
      config: [[socket, httpServerKeys()]],
      policies: [
        everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
          authed,
          'authed',
        ),
      ],
    }).check();

    expect(
      report.endpoints.map(({ pattern, detached }) => [
        pattern,
        detached !== undefined,
      ]),
    ).toEqual([
      ['GET /healthz', true],
      ['GET /readyz', true],
    ]);
  });

  it('обе пробы скрыты от документа причиной', () => {
    const declarations = httpProbes()
      .endpoints as readonly AnyEndpointDefinition[];

    expect(
      declarations.map(({ pattern, doc }) => [
        pattern,
        doc?.hidden !== undefined,
      ]),
    ).toEqual([
      ['GET /healthz', true],
      ['GET /readyz', true],
    ]);
  });
});
