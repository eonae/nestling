/**
 * `assemble` и фазовый рантайм: порядок фаз, fail-fast сборки, резолв
 * зависимостей деклараций и строгий реверс shutdown.
 */

import { makeApp } from './app.js';
import { makeFeature, makePlugin } from './feature.js';
import { MockTransport } from './helpers.js';

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
  makeEmptyContext,
  makeEndpoint,
  makeFail,
  makePipeline,
  Ok,
  stream,
} from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';
import { transportValue } from '@nestling/transport';
import {
  httpEndpoint,
  HttpTransport,
  HttpTransport$,
} from '@nestling/transport.http';
import { z } from 'zod';

/** Регистрирует готовый инстанс транспорта под его токеном */
const asHttpTransport = (transport: ITransport) =>
  transportValue(HttpTransport$('default'), transport);

/** Контекст, который построил бы транспорт: тестам хватает пустого */
const contextFor = (pattern: string, payload?: unknown) =>
  makeEmptyContext(
    { transport: 'http', pattern, payload, attributes: {} },
    { transport: 'http', pattern },
  ) as ExtendableContext<AnyInput>;

describe('assemble — discovery и регистрация', () => {
  it('маршруты дерева модулей передаются транспорту проекциями', async () => {
    const TestEndpoint = httpEndpoint({
      method: 'GET',
      path: '/test',
      input: z.object({ id: z.string() }),
      output: z.object({ result: z.string() }),
      handler: async (input) => new Ok({ result: `test-${input.id}` }),
    });

    const TestModule = makeFeature({
      name: 'test-module',
      endpoints: [TestEndpoint],
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [TestModule],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await app.run();

    expect(transport.routes).toHaveLength(1);
    expect(transport.routes[0].pattern).toBe('GET /test');
    // Проекция несёт то, что уходит по сети, но не исполнение
    expect('handle' in transport.routes[0]).toBe(false);

    await app.close();
  });

  it('объявленные отказы попадают в проекцию маршрута', async () => {
    const QuotaExceeded = makeFail('too_many_requests:quota_exceeded', {
      message: 'Quota exceeded',
    });

    const IQuota = makeToken<{ left(): number }>('IQuota');

    @Injectable([IQuota])
    class ChargeHandler {
      constructor(private readonly quota: { left(): number }) {}

      async handle() {
        const left = this.quota.left();

        return left > 0 ? new Ok({ left }) : QuotaExceeded();
      }
    }

    // Класс-форма: `errors:` обязан пережить получение зависимостей
    const Charge = httpEndpoint({
      method: 'POST',
      path: '/charge',
      output: z.object({ left: z.number() }),
      errors: [QuotaExceeded],
      handler: ChargeHandler,
    });

    const QuotaModule = makeFeature({
      name: 'quota-module',
      providers: [{ provide: IQuota, useValue: { left: () => 0 } }],
      endpoints: [Charge],
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [QuotaModule],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await app.run();

    expect(transport.routes[0].errors).toEqual([QuotaExceeded]);

    await app.close();
  });

  it('endpoint из модуля, не переданного в assemble, не обслуживается', async () => {
    const ForeignEndpoint = httpEndpoint({
      method: 'GET',
      path: '/foreign',
      handler: async () => new Ok({}),
    });

    makeFeature({ name: 'module:foreign', endpoints: [ForeignEndpoint] });

    const transport = new MockTransport();
    const app = makeApp({
      features: [],
      // модуль с endpoint'ом не зарегистрирован
      transports: [asHttpTransport(transport)],
    }).assemble();

    // Старт проходит, транспорт пуст: импорт файла ни на что не влияет
    await app.run();

    expect(transport.routes).toHaveLength(0);

    await app.close();
  });

  it("транспорт без обнаруженных endpoint'ов поднимается", async () => {
    const transport = new MockTransport();
    const app = makeApp({
      features: [makeFeature({ name: 'module:empty' })],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await app.run();

    expect(transport.serving).toBe(true);
    expect(transport.routes).toHaveLength(0);

    await app.close();
  });

  it('пустая сборка допустима', async () => {
    const app = makeApp({}).assemble();

    await expect(app.run()).resolves.toBeUndefined();
    await app.close();
  });
});

describe('assemble — fail-fast фазы ASSEMBLE', () => {
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
      handler: CreateUserHandler,
    });

    // Класс в providers: не перечислен — endpoint регистрирует его сам
    const transport = new MockTransport();
    const app = makeApp({
      features: [
        makeFeature({ name: 'module:class', endpoints: [CreateUser] }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await app.run();

    expect(transport.routes.map((route) => route.pattern)).toEqual([
      'POST /users',
    ]);

    await app.close();
  });

  it('класс-хендлер, перечисленный в providers, — ошибка ASSEMBLE', async () => {
    @Injectable([])
    class CreateUserHandler {
      async handle() {
        return new Ok({});
      }
    }

    const CreateUser = httpEndpoint({
      method: 'POST',
      path: '/users',
      handler: CreateUserHandler,
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [
        makeFeature({
          name: 'module:twice',
          providers: [CreateUserHandler],
          endpoints: [CreateUser],
        }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await expect(app.run()).rejects.toThrow(
      /Handler class 'CreateUserHandler'.*POST \/users.*'module:twice'/s,
    );
    expect(transport.serving).toBe(false);
  });

  it('зависимость класса-хендлера без провайдера — ошибка с токеном и паттерном', async () => {
    const ILogger = makeToken<{ log(): void }>('ILogger');

    @Injectable([ILogger])
    class CreateUserHandler {
      constructor(private readonly logger: { log(): void }) {}

      async handle() {
        this.logger.log();
        return new Ok({});
      }
    }

    const CreateUser = httpEndpoint({
      method: 'POST',
      path: '/users',
      handler: CreateUserHandler,
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [
        makeFeature({ name: 'module:no-logger', endpoints: [CreateUser] }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await expect(app.run()).rejects.toThrow(/ILogger.*CreateUserHandler/s);
    expect(transport.serving).toBe(false);
  });

  it('транспорт, которого нет в графе, — ошибка с именем, паттерном и починкой', async () => {
    const CliTransport$ = makeToken<ITransport>('transport:cli');

    const CliEndpoint = makeEndpoint({
      transport: CliTransport$,
      pattern: 'users:list',
      handler: async () => new Ok({}),
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [makeFeature({ name: 'module:cli', endpoints: [CliEndpoint] })],
      transports: [asHttpTransport(transport)],
    }).assemble();

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
      handler: async () => new Ok({}),
    });

    const app = makeApp({
      features: [
        makeFeature({
          name: 'module:with-resource',
          providers: [Connection],
          endpoints: [Orphan],
        }),
      ],
      transports: [asHttpTransport(new MockTransport())],
    }).assemble();

    await expect(app.run()).rejects.toThrow(/Transport 'cli'/);
    expect(opened).toEqual([]);
  });

  it('форма вне способностей транспорта отвергается на сборке', async () => {
    const Watch = httpEndpoint({
      method: 'GET',
      path: '/watch',
      output: z.object({ id: z.string() }),
      handler: async () => new Ok({ id: '1' }),
    });

    // Мок умеет только value: подменяем декларацию потоковой формой
    const Streaming = makeEndpoint({
      transport: HttpTransport$('default'),
      pattern: 'GET /stream',
      output: stream(z.object({ id: z.string() })) as never,
      handler: async () => new Ok({} as never),
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [
        makeFeature({ name: 'module:forms', endpoints: [Watch, Streaming] }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await expect(app.run()).rejects.toThrow(
      /GET \/stream.*module:forms.*does not support form 'stream' in 'output'/s,
    );
    expect(transport.serving).toBe(false);
  });

  it('элемент endpoints: без бренда — ошибка старта', async () => {
    const Smuggling = makeFeature({
      name: 'smuggling',
      endpoints: [{ transport: 'http', pattern: 'GET /smuggled' }] as never,
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [Smuggling],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await expect(app.run()).rejects.toThrow(
      /smuggling.*index 0.*not an endpoint declaration/s,
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
      handler: async () => new Ok({}),
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [
        makeFeature({ name: 'test-module', endpoints: [BrokenEndpoint] }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await expect(app.run()).rejects.toThrow(
      /Dependency 'UnregisteredUnit'.*GET \/broken.*not available in the DI container/s,
    );
    expect(transport.serving).toBe(false);
  });
});

describe('assemble — фаза WIRE: резолв зависимостей деклараций', () => {
  it('хендлер получает инстанс из DI', async () => {
    @Injectable([])
    class TestService {
      getData() {
        return 'service-data';
      }
    }

    @Injectable([TestService])
    class DataHandler {
      constructor(private readonly service: TestService) {}

      async handle() {
        return new Ok({ data: this.service.getData() });
      }
    }

    const DataEndpoint = httpEndpoint({
      method: 'GET',
      path: '/data',
      handler: DataHandler,
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [
        makeFeature({
          name: 'test-module',
          providers: [TestService],
          endpoints: [DataEndpoint],
        }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

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
      handler: GreetHandler,
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [
        makeFeature({
          name: 'test-module',
          providers: [Greeter],
          endpoints: [Greet],
        }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

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
      handler: async (_payload, meta) => new Ok({ traceId: meta.echo }),
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [
        makeFeature({
          name: 'test-module',
          providers: [WithTracing],
          endpoints: [TracedEndpoint],
        }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

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
  it('порядок наблюдаем: сначала @OnInit, затем @OnStart, затем serve', async () => {
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
    const app = makeApp({
      features: [
        makeFeature({ name: 'module:scheduler', providers: [Scheduler] }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await app.run();

    expect(order).toEqual(['init', 'start', 'serve']);

    await app.close();
  });

  it('shutdown идёт реверсом: сигнал, close() транспортов, @OnDestroy', async () => {
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

    const app = makeApp({
      features: [
        makeFeature({ name: 'module:resource', providers: [Resource] }),
      ],
      transports: [asHttpTransport(first), transportValue(Second$, second)],
    }).assemble();

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
    const app = makeApp({
      features: [
        makeFeature({ name: 'module:resource', providers: [Resource] }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await app.run();
    await app.run();
    await app.close();
    await app.close();

    expect(closes).toEqual(['closed', 'destroyed']);
  });

  it('обработчики сигналов снимаются после close()', async () => {
    const before = process.listenerCount('SIGTERM');

    const app = makeApp({
      transports: [asHttpTransport(new MockTransport())],
    }).assemble();

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
      });

      const app = makeApp({
        features: [Orders],
        transports: [asHttpTransport(new MockTransport())],
      }).assemble();

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

    const app = makeApp({
      features: [
        makeFeature({
          name: 'test-module',
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/wait',
              pipeline: makePipeline(),
              handler: WaitHandler,
            }),
          ],
        }),
      ],
      transports: [asHttpTransport(httpTransport)],
    }).assemble();

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
  it("невыбранная фича не строит провайдеров и не регистрирует endpoint'ов", async () => {
    const built: string[] = [];

    @Injectable([])
    class BillingService {
      constructor() {
        built.push('billing');
      }
    }

    const Orders = makeFeature({
      name: 'orders',
      endpoints: [
        httpEndpoint({
          method: 'GET',
          path: '/orders',
          handler: async () => new Ok({}),
        }),
      ],
    });

    const Billing = makeFeature({
      name: 'billing',
      providers: [BillingService],
      endpoints: [
        httpEndpoint({
          method: 'GET',
          path: '/invoices',
          handler: async () => new Ok({}),
        }),
      ],
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [Orders, Billing],
      transports: [asHttpTransport(transport)],
    }).assemble('orders');

    await app.run();

    expect(built).toEqual([]);
    expect(transport.routes.map((route) => route.pattern)).toEqual([
      'GET /orders',
    ]);

    await app.close();
  });

  it('общий модуль двух единиц регистрируется один раз', async () => {
    const Shared = makeModule({ name: 'module:shared' });

    const Orders = makeFeature({
      name: 'orders',
      modules: [Shared],
      endpoints: [
        httpEndpoint({
          method: 'GET',
          path: '/orders',
          handler: async () => new Ok({}),
        }),
      ],
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [Orders],
      plugins: [
        makePlugin({
          name: '@spec/root',
          modules: [Shared],
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/root',
              handler: async () => new Ok({}),
            }),
          ],
        }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await app.run();

    expect(transport.routes.map((route) => route.pattern)).toEqual([
      'GET /orders',
      'GET /root',
    ]);

    await app.close();
  });

  it('одноимённые разные модули двух фич — ошибка сборки', async () => {
    const Orders = makeFeature({
      name: 'orders',
      modules: [makeModule({ name: 'module:shared' })],
    });

    const Billing = makeFeature({
      name: 'billing',
      modules: [makeModule({ name: 'module:shared' })],
    });

    // Имя модуля — ключ атрибуции его провайдеров, поэтому два разных
    // значения под одним именем роняют сборку на фазе ASSEMBLE, до
    // построения контейнера и любого `@OnInit`
    const app = makeApp({
      features: [Orders, Billing],
      transports: [asHttpTransport(new MockTransport())],
    });

    await expect(app.check()).rejects.toThrow(
      /Two different modules are named 'module:shared'/,
    );
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
      providers: [valueProvider(Billing$, new CountingTransport())],
    });

    const Orders = makeFeature({
      name: 'orders',
    });

    const app = makeApp({
      features: [Orders, Billing],
      transports: [asHttpTransport(new MockTransport())],
    }).assemble('orders');

    await app.run();

    expect(started).toEqual([]);

    await app.close();
  });
});

describe('assemble — именованные экземпляры транспортов', () => {
  it('endpoint уходит на экземпляр, названный в `on:`', async () => {
    const publicApi = new MockTransport();
    const adminApi = new MockTransport();

    const Orders = makeFeature({
      name: 'orders',
      endpoints: [
        httpEndpoint({
          method: 'GET',
          path: '/orders',
          handler: async () => new Ok({}),
        }),
        httpEndpoint({
          method: 'GET',
          path: '/metrics',
          on: 'admin',
          handler: async () => new Ok({}),
        }),
      ],
    });

    const app = makeApp({
      features: [Orders],
      transports: [
        transportValue(HttpTransport$('default'), publicApi),
        transportValue(HttpTransport$('admin'), adminApi, { name: 'admin' }),
      ],
    }).assemble();

    await app.run();

    expect(publicApi.routes.map((route) => route.pattern)).toEqual([
      'GET /orders',
    ]);
    expect(adminApi.routes.map((route) => route.pattern)).toEqual([
      'GET /metrics',
    ]);

    await app.close();
  });

  it('экземпляр, которого нет в корне, роняет сборку', async () => {
    const Orders = makeFeature({
      name: 'orders',
      endpoints: [
        httpEndpoint({
          method: 'GET',
          path: '/metrics',
          on: 'admin',
          handler: async () => new Ok({}),
        }),
      ],
    });

    const app = makeApp({
      features: [Orders],
      transports: [asHttpTransport(new MockTransport())],
    });

    await expect(app.check()).rejects.toThrow(
      /is required by endpoint 'GET \/metrics'/,
    );
  });
});
