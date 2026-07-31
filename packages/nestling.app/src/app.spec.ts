/**
 * `assemble` и фазовый рантайм: порядок фаз, fail-fast сборки, гашение
 * зависимостей деклараций и строгий реверс shutdown.
 */

import { assemble } from './app';
import { makeFeature } from './feature';
import { MockTransport } from './helpers';
import { makeAppModule } from './module';

import { describe, expect, it, jest } from '@jest/globals';
import {
  Injectable,
  makeModule,
  makeToken,
  OnDestroy,
  OnInit,
  OnStart,
  valueProvider,
} from '@nestling/container';
import type { AnyInput, ExtendableContext } from '@nestling/pipeline';
import {
  defineFail,
  makeEmptyContext,
  makeEndpoint,
  makePipeline,
  Ok,
  stream,
} from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';
import {
  httpEndpoint,
  HttpTransport,
  HttpTransport$,
} from '@nestling/transport.http';
import { z } from 'zod';

/** Регистрирует готовый инстанс транспорта под его токеном */
const asHttpTransport = (transport: ITransport) =>
  valueProvider(HttpTransport$, transport);

/** Контекст, который построил бы транспорт: тестам хватает пустого */
const contextFor = (pattern: string, payload?: unknown) =>
  makeEmptyContext(
    { transport: 'http', pattern, payload, attributes: {} },
    { transport: 'http', pattern },
  ) as ExtendableContext<AnyInput>;

describe('assemble — дискавери и регистрация', () => {
  it('маршруты дерева модулей доезжают до транспорта проекциями', async () => {
    const TestEndpoint = httpEndpoint({
      method: 'GET',
      path: '/test',
      input: z.object({ id: z.string() }),
      output: z.object({ result: z.string() }),
      handle: async (input) => new Ok({ result: `test-${input.id}` }),
    });

    const TestModule = makeAppModule({
      name: 'test-module',
      endpoints: [TestEndpoint],
    });

    const transport = new MockTransport();
    const app = assemble({
      modules: [TestModule],
      transports: [asHttpTransport(transport)],
    });

    await app.run();

    expect(transport.routes).toHaveLength(1);
    expect(transport.routes[0].pattern).toBe('GET /test');
    // Проекция несёт провод, но не исполнение
    expect('handle' in transport.routes[0]).toBe(false);

    await app.close();
  });

  it('объявленные отказы доезжают до проекции маршрута', async () => {
    const QuotaExceeded = defineFail('QUOTA_EXCEEDED', {
      status: 'TOO_MANY_REQUESTS',
      message: 'Quota exceeded',
    });

    const IQuota = makeToken<{ left(): number }>('IQuota');

    // Форма с deps: `errors:` обязан пережить `resolve` контейнером
    const Charge = httpEndpoint({
      method: 'POST',
      path: '/charge',
      output: z.object({ left: z.number() }),
      errors: [QuotaExceeded],
      deps: [IQuota],
      handle: (quota) => async () =>
        quota.left() > 0 ? new Ok({ left: quota.left() }) : QuotaExceeded(),
    });

    const QuotaModule = makeAppModule({
      name: 'quota-module',
      providers: [{ provide: IQuota, useValue: { left: () => 0 } }],
      endpoints: [Charge],
    });

    const transport = new MockTransport();
    const app = assemble({
      modules: [QuotaModule],
      transports: [asHttpTransport(transport)],
    });

    await app.run();

    expect(transport.routes[0].errors).toEqual([QuotaExceeded]);

    await app.close();
  });

  it('эндпоинт из модуля, не переданного в assemble, не обслуживается', async () => {
    const ForeignEndpoint = httpEndpoint({
      method: 'GET',
      path: '/foreign',
      handle: async () => new Ok({}),
    });

    makeAppModule({ name: 'module:foreign', endpoints: [ForeignEndpoint] });

    const transport = new MockTransport();
    const app = assemble({
      modules: [], // модуль с эндпоинтом не зарегистрирован
      transports: [asHttpTransport(transport)],
    });

    // Старт проходит, транспорт пуст: импорт файла ни на что не влияет
    await app.run();

    expect(transport.routes).toHaveLength(0);

    await app.close();
  });

  it('транспорт без обнаруженных ручек поднимается', async () => {
    const transport = new MockTransport();
    const app = assemble({
      modules: [makeAppModule({ name: 'module:empty' })],
      transports: [asHttpTransport(transport)],
    });

    await app.run();

    expect(transport.serving).toBe(true);
    expect(transport.routes).toHaveLength(0);

    await app.close();
  });

  it('пустая сборка легальна', async () => {
    const app = assemble({});

    await expect(app.run()).resolves.toBeUndefined();
    await app.close();
  });
});

describe('assemble — fail-fast фазы ASSEMBLE', () => {
  it('токен из deps без провайдера — ошибка старта с паттерном и модулем', async () => {
    const ILogger = makeToken<{ log(message: string): void }>('ILogger');

    const NeedsLogger = httpEndpoint({
      method: 'GET',
      path: '/logged',
      deps: [ILogger],
      handle: (logger) => async () => {
        logger.log('served');
        return new Ok({});
      },
    });

    const transport = new MockTransport();
    const app = assemble({
      modules: [
        makeAppModule({ name: 'module:bad', endpoints: [NeedsLogger] }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await expect(app.run()).rejects.toThrow(
      /Dependency 'ILogger'.*GET \/logged.*module:bad.*not available in the DI container/s,
    );
    expect(transport.serving).toBe(false);
  });

  it('класс-хендлер без регистрации провайдером — ошибка старта', async () => {
    @Injectable([])
    class CreateUserHandler {
      async handle() {
        return new Ok({});
      }
    }

    const CreateUser = httpEndpoint({
      method: 'POST',
      path: '/users',
      handle: CreateUserHandler,
    });

    // Класс в providers: не перечислен — контейнер о нём не знает
    const transport = new MockTransport();
    const app = assemble({
      modules: [
        makeAppModule({ name: 'module:bad-class', endpoints: [CreateUser] }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await expect(app.run()).rejects.toThrow(
      /Dependency 'CreateUserHandler'.*POST \/users.*module:bad-class/s,
    );
    expect(transport.serving).toBe(false);
  });

  it('транспорт, которого нет в графе, — ошибка с именем, паттерном и починкой', async () => {
    const CliTransport$ = makeToken<ITransport>('transport:cli');

    const CliEndpoint = makeEndpoint({
      transport: CliTransport$,
      pattern: 'users:list',
      handle: async () => new Ok({}),
    });

    const transport = new MockTransport();
    const app = assemble({
      modules: [
        makeAppModule({ name: 'module:cli', endpoints: [CliEndpoint] }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await expect(app.run()).rejects.toThrow(
      /Transport 'cli'.*users:list.*module:cli.*'transports:'/s,
    );
    expect(transport.serving).toBe(false);
  });

  it('ошибка сборки предшествует @OnInit', async () => {
    const opened: string[] = [];

    @Injectable([])
    class Connection {
      @OnInit()
      open(): void {
        opened.push('connection');
      }
    }

    const CliTransport$ = makeToken<ITransport>('transport:cli');
    const Orphan = makeEndpoint({
      transport: CliTransport$,
      pattern: 'orphan',
      handle: async () => new Ok({}),
    });

    const app = assemble({
      modules: [
        makeAppModule({
          name: 'module:with-resource',
          providers: [Connection],
          endpoints: [Orphan],
        }),
      ],
      transports: [asHttpTransport(new MockTransport())],
    });

    await expect(app.run()).rejects.toThrow(/Transport 'cli'/);
    expect(opened).toEqual([]);
  });

  it('форма вне способностей транспорта отвергается на сборке', async () => {
    const Watch = httpEndpoint({
      method: 'GET',
      path: '/watch',
      output: z.object({ id: z.string() }),
      handle: async () => new Ok({ id: '1' }),
    });

    // Мок умеет только value: подменяем декларацию потоковой формой
    const Streaming = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /stream',
      output: stream(z.object({ id: z.string() })) as never,
      handle: async () => new Ok({} as never),
    });

    const transport = new MockTransport();
    const app = assemble({
      modules: [
        makeAppModule({ name: 'module:forms', endpoints: [Watch, Streaming] }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await expect(app.run()).rejects.toThrow(
      /GET \/stream.*module:forms.*does not support form 'stream' in 'output'/s,
    );
    expect(transport.serving).toBe(false);
  });

  it('элемент endpoints: без бренда — ошибка старта', async () => {
    const SmugglingModule = {
      ...makeModule({ name: 'module:smuggling' }),
      endpoints: [{ transport: 'http', pattern: 'GET /smuggled' }],
    };

    const transport = new MockTransport();
    const app = assemble({
      modules: [SmugglingModule],
      transports: [asHttpTransport(transport)],
    });

    await expect(app.run()).rejects.toThrow(
      /module:smuggling.*index 0.*not an endpoint declaration/s,
    );
    expect(transport.serving).toBe(false);
  });

  it('незарегистрированный класс-юнит — ошибка старта до приёма запросов', async () => {
    class UnregisteredUnit {
      handle(): { traceId: string } {
        return { traceId: 'never' };
      }
    }

    const BrokenEndpoint = httpEndpoint({
      method: 'GET',
      path: '/broken',
      pipeline: makePipeline().pre(UnregisteredUnit),
      handle: async () => new Ok({}),
    });

    const transport = new MockTransport();
    const app = assemble({
      modules: [
        makeAppModule({ name: 'test-module', endpoints: [BrokenEndpoint] }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await expect(app.run()).rejects.toThrow(
      /Dependency 'UnregisteredUnit'.*GET \/broken.*not available in the DI container/s,
    );
    expect(transport.serving).toBe(false);
  });
});

describe('assemble — фаза WIRE: гашение зависимостей деклараций', () => {
  it('хендлер получает инстанс из DI', async () => {
    @Injectable([])
    class TestService {
      getData() {
        return 'service-data';
      }
    }

    const DataEndpoint = httpEndpoint({
      method: 'GET',
      path: '/data',
      deps: [TestService],
      handle: (service) => async () => new Ok({ data: service.getData() }),
    });

    const transport = new MockTransport();
    const app = assemble({
      modules: [
        makeAppModule({
          name: 'test-module',
          providers: [TestService],
          endpoints: [DataEndpoint],
        }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await app.run();

    const response = await transport.dispatch?.call(
      'GET /data',
      contextFor('GET /data'),
    );

    expect(response).toMatchObject({
      isSuccess: true,
      value: { data: 'service-data' },
    });

    await app.close();
  });

  it('класс-хендлер резолвится контейнером как обычный провайдер', async () => {
    @Injectable([])
    class Greeter {
      greet() {
        return 'hi';
      }
    }

    @Injectable([Greeter])
    class GreetHandler {
      constructor(private readonly greeter: Greeter) {}

      async handle() {
        return new Ok({ greeting: this.greeter.greet() });
      }
    }

    const Greet = httpEndpoint({
      method: 'GET',
      path: '/greet',
      handle: GreetHandler,
    });

    const transport = new MockTransport();
    const app = assemble({
      modules: [
        makeAppModule({
          name: 'test-module',
          providers: [Greeter, GreetHandler],
          endpoints: [Greet],
        }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await app.run();

    const response = await transport.dispatch?.call(
      'GET /greet',
      contextFor('GET /greet'),
    );

    expect(response).toMatchObject({
      isSuccess: true,
      value: { greeting: 'hi' },
    });

    await app.close();
  });

  it('классы-юниты пайплайна связываются контейнером', async () => {
    @Injectable([])
    class WithTracing {
      handle(): { traceId: string } {
        return { traceId: 'trace-from-di' };
      }
    }

    const TracedEndpoint = httpEndpoint({
      method: 'GET',
      path: '/traced',
      pipeline: makePipeline()
        .pre(WithTracing)
        .pre(async (ctx) => ({ echo: ctx.input.traceId })),
      handle: async (_payload, meta) => new Ok({ traceId: meta.echo }),
    });

    const transport = new MockTransport();
    const app = assemble({
      modules: [
        makeAppModule({
          name: 'test-module',
          providers: [WithTracing],
          endpoints: [TracedEndpoint],
        }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await app.run();

    const response = await transport.dispatch?.call(
      'GET /traced',
      contextFor('GET /traced'),
    );

    expect(response).toMatchObject({
      isSuccess: true,
      value: { traceId: 'trace-from-di' },
    });

    await app.close();
  });
});

describe('assemble — порядок фаз и shutdown', () => {
  it('порядок наблюдаем: @OnInit → @OnStart → serve', async () => {
    const order: string[] = [];

    @Injectable([])
    class Scheduler {
      @OnInit()
      init(): void {
        order.push('init');
      }

      @OnStart()
      start(): void {
        order.push('start');
      }
    }

    class ObservingTransport extends MockTransport {
      async serve(...args: Parameters<MockTransport['serve']>): Promise<void> {
        order.push('serve');
        await super.serve(...args);
      }
    }

    const transport = new ObservingTransport();
    const app = assemble({
      modules: [
        makeAppModule({ name: 'module:scheduler', providers: [Scheduler] }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await app.run();

    expect(order).toEqual(['init', 'start', 'serve']);

    await app.close();
  });

  it('shutdown идёт реверсом: сигнал → close() транспортов → @OnDestroy', async () => {
    const order: string[] = [];

    @Injectable([])
    class Resource {
      @OnDestroy()
      destroy(): void {
        order.push('container-destroyed');
      }
    }

    const first = new MockTransport(() => order.push('first-closed'));
    const second = new MockTransport(() => order.push('second-closed'));
    const Second$ = makeToken<ITransport>('transport:second');

    const app = assemble({
      modules: [
        makeAppModule({ name: 'module:resource', providers: [Resource] }),
      ],
      transports: [asHttpTransport(first), valueProvider(Second$, second)],
    });

    await app.run();

    first.signal?.addEventListener('abort', () => order.push('signal-aborted'));

    await app.close();

    expect(order).toEqual([
      'signal-aborted',
      'second-closed',
      'first-closed',
      'container-destroyed',
    ]);
  });

  it('run() и close() идемпотентны', async () => {
    const closes: string[] = [];

    @Injectable([])
    class Resource {
      @OnDestroy()
      destroy(): void {
        closes.push('destroyed');
      }
    }

    const transport = new MockTransport(() => closes.push('closed'));
    const app = assemble({
      modules: [
        makeAppModule({ name: 'module:resource', providers: [Resource] }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await app.run();
    await app.run();
    await app.close();
    await app.close();

    expect(closes).toEqual(['closed', 'destroyed']);
  });

  it('обработчики сигналов снимаются после close()', async () => {
    const before = process.listenerCount('SIGTERM');

    const app = assemble({
      transports: [asHttpTransport(new MockTransport())],
    });

    await app.run();
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);

    await app.close();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('состав сборки печатается одной строкой', async () => {
    const log = jest
      .spyOn(console, 'log')
      .mockImplementation((): void => undefined);

    try {
      const Orders = makeFeature({
        name: 'orders',
        modules: [makeAppModule({ name: 'module:orders' })],
      });

      const app = assemble({
        features: [Orders],
        transports: [asHttpTransport(new MockTransport())],
      });

      await app.run();

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('features: orders'),
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('transports: http'),
      );

      await app.close();
    } finally {
      log.mockRestore();
    }
  });

  it('close() взводит meta.signal in-flight HTTP-запроса до @OnDestroy', async () => {
    const order: string[] = [];
    let onStarted!: () => void;
    const started = new Promise<void>((r) => (onStarted = r));
    let onAborted!: (reason: unknown) => void;
    const aborted = new Promise<unknown>((r) => (onAborted = r));

    @Injectable([])
    class WaitHandler {
      handle(_payload: unknown, meta: { signal: AbortSignal }) {
        onStarted();
        meta.signal.addEventListener(
          'abort',
          () => onAborted(meta.signal.reason),
          { once: true },
        );
        return aborted.then(() => ({ done: true }));
      }

      @OnDestroy()
      destroy() {
        order.push('container-destroyed');
      }
    }

    class ObservableHttpTransport extends HttpTransport {
      async close(): Promise<void> {
        await super.close();
        order.push('transport-closed');
      }
    }

    const httpTransport = new ObservableHttpTransport({
      port: 0,
      host: '127.0.0.1',
    });

    const app = assemble({
      modules: [
        makeAppModule({
          name: 'test-module',
          providers: [WaitHandler],
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/wait',
              pipeline: makePipeline(),
              handle: WaitHandler,
            }),
          ],
        }),
      ],
      transports: [asHttpTransport(httpTransport)],
    });

    await app.run();

    const address = httpTransport.address();
    if (!address) {
      throw new Error('transport did not report an address after serve()');
    }

    const pending = fetch(`http://127.0.0.1:${address.port}/wait`).catch(
      () => null,
    );
    await started;

    await app.close();

    const reason = await aborted;
    expect((reason as Error).message).toBe('transport closing');
    expect(order).toEqual(['transport-closed', 'container-destroyed']);

    await pending;
  });
});

describe('assemble — фичи в приложении', () => {
  it('невыбранная фича не строит провайдеров и не регистрирует ручек', async () => {
    const built: string[] = [];

    @Injectable([])
    class BillingService {
      constructor() {
        built.push('billing');
      }
    }

    const Orders = makeFeature({
      name: 'orders',
      modules: [
        makeAppModule({
          name: 'module:orders',
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/orders',
              handle: async () => new Ok({}),
            }),
          ],
        }),
      ],
    });

    const Billing = makeFeature({
      name: 'billing',
      modules: [
        makeAppModule({
          name: 'module:billing',
          providers: [BillingService],
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/invoices',
              handle: async () => new Ok({}),
            }),
          ],
        }),
      ],
    });

    const transport = new MockTransport();
    const app = assemble({
      features: [Orders, Billing],
      select: 'orders',
      transports: [asHttpTransport(transport)],
    });

    await app.run();

    expect(built).toEqual([]);
    expect(transport.routes.map((route) => route.pattern)).toEqual([
      'GET /orders',
    ]);

    await app.close();
  });

  it('modules корня и модули выбранных фич совмещаются, дубли — один раз', async () => {
    const Shared = makeAppModule({ name: 'module:shared' });

    const Orders = makeFeature({
      name: 'orders',
      modules: [
        Shared,
        makeAppModule({
          name: 'module:orders',
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/orders',
              handle: async () => new Ok({}),
            }),
          ],
        }),
      ],
    });

    const transport = new MockTransport();
    const app = assemble({
      modules: [
        Shared,
        makeAppModule({
          name: 'module:root',
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/root',
              handle: async () => new Ok({}),
            }),
          ],
        }),
      ],
      features: [Orders],
      transports: [asHttpTransport(transport)],
    });

    await app.run();

    expect(transport.routes.map((route) => route.pattern)).toEqual([
      'GET /root',
      'GET /orders',
    ]);

    await app.close();
  });

  it('транспорт невыбранной фичи не поднимается', async () => {
    const started: string[] = [];

    class CountingTransport extends MockTransport {
      async serve(...args: Parameters<MockTransport['serve']>): Promise<void> {
        started.push('billing-transport');
        await super.serve(...args);
      }
    }

    const Billing$ = makeToken<ITransport>('transport:billing');
    const Billing = makeFeature({
      name: 'billing',
      modules: [
        makeAppModule({
          name: 'module:billing-infra',
          providers: [valueProvider(Billing$, new CountingTransport())],
        }),
      ],
    });

    const Orders = makeFeature({
      name: 'orders',
      modules: [makeAppModule({ name: 'module:orders' })],
    });

    const app = assemble({
      features: [Orders, Billing],
      select: 'orders',
      transports: [asHttpTransport(new MockTransport())],
    });

    await app.run();

    expect(started).toEqual([]);

    await app.close();
  });
});
