/**
 * `assembleTest` целиком: остановка после WIRE, подстановки, in-proc
 * `call` через полный пайплайн, конфиг объектом и SHUTDOWN.
 */

import { SpyTransport } from './__fixtures__/transport';
import { assembleTest } from './app';
import { vars } from './config';
import { familyOverride } from './overrides';
import { unwrap, UnwrapFailedError } from './unwrap';

import { describe, expect, it, jest } from '@jest/globals';
import { makeAppModule, makeFeature } from '@nestling/app';
import type { Config } from '@nestling/config';
import { makeConfig } from '@nestling/config';
import {
  Injectable,
  makeToken,
  makeTokenFamily,
  OnDestroy,
  OnInit,
  OnStart,
  valueProvider,
} from '@nestling/container';
import { defineFail, makePipeline, Ok, validate } from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

const asHttpTransport = (transport: ITransport) =>
  valueProvider(HttpTransport$, transport);

/** Даёт микрозадачам подписки прокрутиться */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('assembleTest — приложение собрано, но не в эфире', () => {
  it('выполняет @OnInit и строит dispatch, но не START', async () => {
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
      output: z.object({ pong: z.boolean() }),
      handle: async () => new Ok({ pong: true }),
    });

    const transport = new SpyTransport();

    await using app = await assembleTest({
      modules: [
        makeAppModule({
          name: 'module:ping',
          providers: [Service],
          endpoints: [Ping],
        }),
      ],
      transports: [asHttpTransport(transport)],
    });

    expect(events).toEqual(['init']);
    expect(transport.serving).toBe(false);
    expect(unwrap(await app.call(Ping))).toEqual({ pong: true });
  });

  it('не трогает процесс: ни обработчиков сигналов, ни stdout', async () => {
    const before = process.listenerCount('SIGTERM');
    const log = jest
      .spyOn(console, 'log')
      .mockImplementation((): void => undefined);

    try {
      await using app = await assembleTest({
        modules: [makeAppModule({ name: 'module:quiet' })],
        transports: [asHttpTransport(new SpyTransport())],
      });

      expect(app.features).toEqual([]);
      expect(process.listenerCount('SIGTERM')).toBe(before);
      expect(process.listenerCount('SIGINT')).toBe(before);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('отклоняет ручку без транспорта той же ошибкой, что и бой', async () => {
    const inits: string[] = [];

    @Injectable([])
    class Resource {
      @OnInit()
      open(): void {
        inits.push('init');
      }
    }

    const Orphan = httpEndpoint({
      method: 'GET',
      path: '/orphan',
      handle: async () => new Ok({}),
    });

    await expect(
      assembleTest({
        modules: [
          makeAppModule({
            name: 'module:orphan',
            providers: [Resource],
            endpoints: [Orphan],
          }),
        ],
      }),
    ).rejects.toThrow(/Transport 'http'.*module:orphan.*'transports:'/s);

    expect(inits).toEqual([]);
  });

  it('закрывается реверсом и переживает повторный close()', async () => {
    const events: string[] = [];

    @Injectable([])
    class Pool {
      @OnDestroy()
      disconnect(): void {
        events.push('destroy:pool');
      }
    }

    @Injectable([Pool])
    class Service {
      constructor(readonly pool: Pool) {}

      @OnDestroy()
      drain(): void {
        events.push('destroy:service');
      }
    }

    const app = await assembleTest({
      modules: [
        makeAppModule({
          name: 'module:resources',
          providers: [Pool, Service],
        }),
      ],
    });

    await app.close();
    await app.close();

    expect(events).toEqual(['destroy:service', 'destroy:pool']);
  });
});

describe('assembleTest — overrides и прунинг', () => {
  interface IPool {
    query(): string;
  }

  interface IRepository {
    all(): string[];
  }

  const Pool = makeToken<IPool>('AppPool');
  const Repository = makeToken<IRepository>('AppRepository');

  @Injectable(Pool, [])
  class PgPool implements IPool {
    query(): string {
      return 'from-pg';
    }
  }

  @Injectable(Repository, [Pool])
  class PgRepository implements IRepository {
    constructor(private readonly pool: IPool) {}

    all(): string[] {
      return [this.pool.query()];
    }
  }

  const ListUsers = httpEndpoint({
    method: 'GET',
    path: '/users',
    output: z.object({ users: z.array(z.string()) }),
    deps: [Repository],
    handle: (repository: IRepository) => async () =>
      new Ok({ users: repository.all() }),
  });

  const DataModule = makeAppModule({
    name: 'module:data',
    providers: [PgPool, PgRepository],
    endpoints: [ListUsers],
  });

  it('подставляет фейк и прунит осиротевший узел', async () => {
    await using app = await assembleTest({
      modules: [DataModule],
      transports: [asHttpTransport(new SpyTransport())],
      overrides: [[Repository, { all: () => ['from-fake'] }]],
    });

    expect(unwrap(await app.call(ListUsers))).toEqual({
      users: ['from-fake'],
    });
    expect(app.pruned).toEqual(['AppPool']);
    expect(app.get(Pool)).toBeNull();
  });

  it('без overrides граф остаётся полным', async () => {
    await using app = await assembleTest({
      modules: [DataModule],
      transports: [asHttpTransport(new SpyTransport())],
    });

    expect(app.pruned).toEqual([]);
    expect(app.get(Pool)?.query()).toBe('from-pg');
  });
});

describe('app.call — полный пайплайн in-proc', () => {
  const NotFound = defineFail('USER_NOT_FOUND', {
    status: 'NOT_FOUND',
    message: 'User not found',
  });

  const GetUser = httpEndpoint({
    method: 'GET',
    path: '/users/:id',
    input: z.object({ id: z.string() }),
    output: z.object({ id: z.string(), name: z.string() }),
    errors: [NotFound],
    pipeline: makePipeline().pre(validate()),
    handle: async (input) =>
      input.id === '1' ? new Ok({ id: '1', name: 'Alice' }) : NotFound(),
  });

  const Frame = httpEndpoint({
    method: 'GET',
    path: '/frame',
    output: z.object({
      transport: z.string(),
      pattern: z.string(),
      attributes: z.record(z.string(), z.unknown()),
    }),
    pipeline: makePipeline().pre(async (ctx) => ({
      seen: {
        transport: ctx.raw.transport,
        pattern: ctx.raw.pattern,
        attributes: ctx.raw.attributes,
      },
    })),
    handle: async (_payload, meta) => new Ok(meta.seen),
  });

  const UsersModule = makeAppModule({
    name: 'module:users',
    endpoints: [GetUser, Frame],
  });

  const spec = {
    modules: [UsersModule],
    transports: [asHttpTransport(new SpyTransport())],
  };

  it('исполняет ручку целиком и отдаёт успех', async () => {
    await using app = await assembleTest(spec);

    expect(unwrap(await app.call(GetUser, { id: '1' }))).toEqual({
      id: '1',
      name: 'Alice',
    });
  });

  it('отдаёт объявленный отказ со статусом и кодом', async () => {
    await using app = await assembleTest(spec);

    const response = await app.call(GetUser, { id: '404' });

    expect(response.isSuccess).toBe(false);
    expect(response).toMatchObject({
      status: 'NOT_FOUND',
      value: { code: 'USER_NOT_FOUND' },
    });
    expect(() => unwrap(response)).toThrow(UnwrapFailedError);
    expect(() => unwrap(response)).toThrow(/NOT_FOUND.*USER_NOT_FOUND/);
  });

  it('отдаёт отказ валидации на невалидном входе', async () => {
    await using app = await assembleTest(spec);

    const response = await app.call(GetUser, { id: 42 as unknown as string });

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'BAD_REQUEST',
      value: { code: 'VALIDATION_FAILED' },
    });
  });

  it('даёт слою честный, но пустой кадр запроса', async () => {
    await using app = await assembleTest(spec);

    expect(unwrap(await app.call(Frame))).toEqual({
      transport: 'http',
      pattern: 'GET /frame',
      attributes: {},
    });

    expect(
      unwrap(await app.call(Frame, undefined, { attributes: { trace: 'x' } })),
    ).toMatchObject({ attributes: { trace: 'x' } });
  });

  it('перечисляет доступные ручки, если декларации в приложении нет', async () => {
    const Invoices = httpEndpoint({
      method: 'GET',
      path: '/invoices',
      handle: async () => new Ok({}),
    });

    const Billing = makeFeature({
      name: 'billing',
      modules: [
        makeAppModule({ name: 'module:billing', endpoints: [Invoices] }),
      ],
    });

    const Users = makeFeature({ name: 'users', modules: [UsersModule] });

    await using app = await assembleTest({
      features: [Users, Billing],
      select: 'users',
      transports: [asHttpTransport(new SpyTransport())],
    });

    await expect(app.call(Invoices)).rejects.toThrow(
      /GET \/invoices.*not part of the assembled application.*GET \/users\/:id/s,
    );
  });

  it('взводит ctx.signal незавершённого вызова на close()', async () => {
    let onStarted!: () => void;
    const started = new Promise<void>((resolve) => (onStarted = resolve));
    let onAborted!: () => void;
    const aborted = new Promise<void>((resolve) => (onAborted = resolve));

    const Wait = httpEndpoint({
      method: 'GET',
      path: '/wait',
      pipeline: makePipeline(),
      handle: async (_payload, meta) => {
        onStarted();
        meta.signal.addEventListener('abort', () => onAborted(), {
          once: true,
        });
        await aborted;
        return new Ok({});
      },
    });

    const app = await assembleTest({
      modules: [makeAppModule({ name: 'module:wait', endpoints: [Wait] })],
      transports: [asHttpTransport(new SpyTransport())],
    });

    const pending = app.call(Wait);
    await started;

    await app.close();
    await expect(aborted).resolves.toBeUndefined();
    await pending;
  });
});

describe('vars и familyOverride', () => {
  const UsersConfig = makeConfig('users', {
    pageSize: z.coerce.number().default(50),
  });

  const RuntimeConfig = makeConfig.reloadable('runtime', {
    logLevel: z.enum(['debug', 'info']).default('info'),
  });

  const Page = makeToken<{ size: number }>('PageSetting');
  const Runtime = makeToken<Config<typeof RuntimeConfig>>('RuntimeSetting');

  it('проецирует секцию из объекта, не трогая process.env', async () => {
    expect(process.env.USERS_PAGE_SIZE).toBeUndefined();

    await using app = await assembleTest({
      providers: [
        {
          provide: Page,
          useFactory: (cfg: Config<typeof UsersConfig>) => ({
            size: cfg.pageSize,
          }),
          deps: [UsersConfig],
        },
      ],
      config: vars({ USERS_PAGE_SIZE: '10' }),
    });

    expect(app.get(Page)).toEqual({ size: 10 });
    expect(process.env.USERS_PAGE_SIZE).toBeUndefined();
  });

  it('перепроецирует reloadable-секцию на src.set(...)', async () => {
    const source = vars({ RUNTIME_LOG_LEVEL: 'info' });
    const seen: string[] = [];

    await using app = await assembleTest({
      providers: [
        {
          provide: Runtime,
          useFactory: (cfg: Config<typeof RuntimeConfig>) => cfg,
          deps: [RuntimeConfig],
        },
      ],
      config: [[source, '*']],
    });

    const subscription = new AbortController();
    const cfg = app.get(Runtime);
    cfg?.onChange(subscription.signal, () => seen.push(cfg.logLevel));

    expect(cfg?.logLevel).toBe('info');

    source.set('RUNTIME_LOG_LEVEL', 'debug');
    await settle();

    expect(cfg?.logLevel).toBe('debug');
    expect(seen).toEqual(['debug']);
  });

  it('подменяет рецепт семейства для каждого инжекта', async () => {
    interface ILoggerService {
      log(message: string): void;
    }

    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'TestingLogger',
    );

    let productionCalls = 0;
    const noop: ILoggerService = { log: (): void => undefined };

    const Sink = makeToken<ILoggerService[]>('LoggerSink');

    await using app = await assembleTest({
      modules: [
        makeAppModule({
          name: 'module:logging',
          providers: [
            {
              family: ILogger,
              recipe: (scope: string) => {
                productionCalls += 1;
                return valueProvider(ILogger(scope), {
                  log: (): void => undefined,
                  scope,
                } as ILoggerService);
              },
            },
            {
              provide: Sink,
              useFactory: (...loggers: ILoggerService[]) => loggers,
              deps: [ILogger('users'), ILogger('orders')],
            },
          ],
        }),
      ],
      overrides: [familyOverride(ILogger, () => noop)],
    });

    expect(productionCalls).toBe(0);
    expect(app.get(Sink)).toEqual([noop, noop]);
  });
});
