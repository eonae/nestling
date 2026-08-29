/* eslint-disable @typescript-eslint/no-empty-function --
 * noop-юниты: политика проверяет происхождение слоя, а не его эффект */
/**
 * Инварианты на собранном графе: прогон политик в `run()`, `check()` и
 * тестовом шве.
 *
 * Предмет проверки — точка проверки (до захвата ресурсов, после структурных
 * сверок), агрегированная диагностика и поведение `detached` как
 * поверхности для аудита.
 */

import { assemble } from './app';
import { makeFeature } from './feature';
import { MockTransport } from './helpers';
import { makeAppModule } from './module';

import { describe, expect, it, jest } from '@jest/globals';
import {
  Injectable,
  makeToken,
  OnInit,
  valueProvider,
} from '@nestling/container';
import {
  compose,
  everyEndpoint,
  makeEndpoint,
  makePipeline,
  Ok,
} from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';

const asHttpTransport = (transport: ITransport) =>
  valueProvider(HttpTransport$, transport);

const base = makePipeline().pre(() => {});
const authedBase = makePipeline().pre(() => {});
const observability = makePipeline().pre(() => {});

const Authed = httpEndpoint({
  method: 'GET',
  path: '/me',
  pipeline: compose(observability, authedBase),
  handle: async () => new Ok({ id: '1' }),
});

const Unauthed = httpEndpoint({
  method: 'GET',
  path: '/users',
  pipeline: compose(observability, base),
  handle: async () => new Ok({ users: [] }),
});

const NoPipeline = httpEndpoint({
  method: 'GET',
  path: '/metrics',
  handle: async () => new Ok({ up: 1 }),
});

const Detached = httpEndpoint({
  method: 'GET',
  path: '/health',
  detached: 'liveness-проба балансировщика: до auth не доходит',
  handle: async () => new Ok({ status: 'up' }),
});

/** Текст отказа сборки: тесты диагностики читают сообщение целиком */
const messageOf = async (assembling: Promise<unknown>): Promise<string> =>
  assembling.then(
    () => '(assembled successfully)',
    (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  );

const hasAuth = () =>
  everyEndpoint({ transport: HttpTransport$ }).hasLayer(
    authedBase,
    'authedBase',
  );

const hasObservability = () =>
  everyEndpoint().hasLayer(observability, 'observability');

describe('политики — точка проверки', () => {
  it('нарушение падает до @OnInit и до начала приёма запросов', async () => {
    const events: string[] = [];

    @Injectable([])
    class Connection {
      @OnInit()
      open(): void {
        events.push('init');
      }
    }

    const transport = new MockTransport();
    const app = assemble({
      modules: [
        makeAppModule({
          name: 'module:users',
          providers: [Connection],
          endpoints: [Unauthed],
        }),
      ],
      transports: [asHttpTransport(transport)],
      policies: [hasAuth()],
    });

    await expect(app.run()).rejects.toThrow(/assembly policies/);

    expect(events).toEqual([]);
    expect(transport.serving).toBe(false);
  });

  it('структурная ошибка называется раньше нарушения политики', async () => {
    const CliTransport$ = makeToken<ITransport>('transport:cli');
    const Orphan = makeEndpoint({
      transport: CliTransport$,
      pattern: 'orphan',
      handle: async () => new Ok({}),
    });

    const app = assemble({
      modules: [makeAppModule({ name: 'module:cli', endpoints: [Orphan] })],
      transports: [asHttpTransport(new MockTransport())],
      policies: [everyEndpoint().hasLayer(authedBase, 'authedBase')],
    });

    await expect(app.check()).rejects.toThrow(/Transport 'cli' is required/);
  });

  it('endpoint невыбранной фичи не проверяется', async () => {
    const Users = makeFeature({
      name: 'users',
      modules: [makeAppModule({ name: 'module:users', endpoints: [Unauthed] })],
    });
    const Profile = makeFeature({
      name: 'profile',
      modules: [makeAppModule({ name: 'module:profile', endpoints: [Authed] })],
    });

    const report = await assemble({
      features: [Users, Profile],
      select: 'profile',
      transports: [asHttpTransport(new MockTransport())],
      policies: [hasAuth()],
    }).check();

    expect(report.endpoints.map((e) => e.pattern)).toEqual(['GET /me']);
  });

  it('без политик поведение прежнее', async () => {
    const app = assemble({
      modules: [makeAppModule({ name: 'module:users', endpoints: [Unauthed] })],
      transports: [asHttpTransport(new MockTransport())],
    });

    await expect(app.check()).resolves.toBeDefined();
  });

  it('пустой список политик эквивалентен их отсутствию', async () => {
    const app = assemble({
      modules: [
        makeAppModule({ name: 'module:users', endpoints: [NoPipeline] }),
      ],
      transports: [asHttpTransport(new MockTransport())],
      policies: [],
    });

    await expect(app.check()).resolves.toBeDefined();
  });

  it("приложение без endpoint'ов проходит любую политику", async () => {
    await expect(
      assemble({ policies: [everyEndpoint().hasLayer(authedBase)] }).check(),
    ).resolves.toBeDefined();
  });
});

describe('политики — агрегированная диагностика', () => {
  it('перечисляет нарушения обеих политик, сгруппированные по политике', async () => {
    const app = assemble({
      modules: [
        makeAppModule({
          name: 'module:users',
          endpoints: [Unauthed, NoPipeline],
        }),
      ],
      transports: [asHttpTransport(new MockTransport())],
      policies: [hasAuth(), hasObservability()],
    });

    const message = await messageOf(app.check());

    // Три нарушения: два endpoint'а под auth-политикой и endpoint без
    // пайплайна под политикой observability
    expect(message).toContain('3 endpoint violation(s)');
    expect(message).toContain("policy: every endpoint (transport 'http')");
    expect(message).toContain(
      "policy: every endpoint has layer 'observability'",
    );
    expect(message).toContain("GET /users (http, module 'module:users')");
    expect(message).toContain("GET /metrics (http, module 'module:users')");
    expect(message).toContain('declares no pipeline');
    expect(message).toContain("detached: '<reason>'");
  });

  it('соблюдённая политика в сообщении не упоминается', async () => {
    const app = assemble({
      modules: [makeAppModule({ name: 'module:profile', endpoints: [Authed] })],
      transports: [asHttpTransport(new MockTransport())],
      policies: [hasAuth(), hasObservability()],
    });

    await expect(app.check()).resolves.toBeDefined();
  });
});

describe('detached — поверхность для аудита', () => {
  it('помеченный endpoint не нарушает, непомеченный сосед — нарушает', async () => {
    const app = assemble({
      modules: [
        makeAppModule({
          name: 'module:ops',
          endpoints: [Detached, NoPipeline],
        }),
      ],
      transports: [asHttpTransport(new MockTransport())],
      policies: [hasAuth()],
    });

    const message = await messageOf(app.check());

    expect(message).toContain('GET /metrics');
    expect(message).not.toContain('GET /health');
  });

  it('отчёт check() несёт причину значением', async () => {
    const report = await assemble({
      modules: [
        makeAppModule({
          name: 'module:ops',
          endpoints: [Detached, Authed],
        }),
      ],
      transports: [asHttpTransport(new MockTransport())],
    }).check();

    const health = report.endpoints.find((e) => e.pattern === 'GET /health');
    const me = report.endpoints.find((e) => e.pattern === 'GET /me');

    expect(health?.detached).toBe(
      'liveness-проба балансировщика: до auth не доходит',
    );
    expect(me?.detached).toBeUndefined();
  });

  it("список печатается на старте, а без detached-endpoint'ов — не печатается", async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const withDetached = assemble({
        modules: [makeAppModule({ name: 'module:ops', endpoints: [Detached] })],
        transports: [asHttpTransport(new MockTransport())],
      });

      await withDetached.run();
      await withDetached.close();

      expect(
        log.mock.calls.some(([line]) =>
          String(line).includes(
            'detached from policies: GET /health (http) — liveness-проба',
          ),
        ),
      ).toBe(true);

      log.mockClear();

      const clean = assemble({
        modules: [
          makeAppModule({ name: 'module:profile', endpoints: [Authed] }),
        ],
        transports: [asHttpTransport(new MockTransport())],
      });

      await clean.run();
      await clean.close();

      expect(
        log.mock.calls.some(([line]) =>
          String(line).includes('detached from policies'),
        ),
      ).toBe(false);
    } finally {
      log.mockRestore();
    }
  });
});
