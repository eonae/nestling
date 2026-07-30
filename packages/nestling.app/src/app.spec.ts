import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { App } from './app';
import { MockTransport } from './helpers';
import { makeAppModule } from './module';

import { describe, expect, it } from '@jest/globals';
import {
  Injectable,
  makeModule,
  makeToken,
  OnDestroy,
} from '@nestling/container';
import type { AnyInput, ExtendableContext } from '@nestling/pipeline';
import {
  makeEmptyContext,
  makeEndpoint,
  makePipeline,
  Ok,
} from '@nestling/pipeline';
import { httpEndpoint, HttpTransport } from '@nestling/transport.http';
import { z } from 'zod';

describe('App Integration', () => {
  it('обнаруживает декларации в дереве модулей и регистрирует их', async () => {
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

    const mockTransport = new MockTransport();

    const app = new App({
      transports: {
        http: mockTransport as any,
      },
      modules: [TestModule],
    });

    await app.run();

    expect(mockTransport.endpoints).toHaveLength(1);
    expect(mockTransport.endpoints[0].pattern).toBe('GET /test');

    await app.close();
  });

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

    const BadModule = makeAppModule({
      name: 'module:bad',
      endpoints: [NeedsLogger],
    });

    const mockTransport = new MockTransport();

    const app = new App({
      transports: { http: mockTransport },
      modules: [BadModule],
    });

    await expect(app.run()).rejects.toThrow(
      /Dependency 'ILogger'.*GET \/logged.*module:bad.*not available in the DI container/s,
    );
    expect(mockTransport.endpoints).toHaveLength(0);
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
    const BadModule = makeAppModule({
      name: 'module:bad-class',
      endpoints: [CreateUser],
    });

    const mockTransport = new MockTransport();

    const app = new App({
      transports: { http: mockTransport },
      modules: [BadModule],
    });

    await expect(app.run()).rejects.toThrow(
      /Dependency 'CreateUserHandler'.*POST \/users.*module:bad-class/s,
    );
    expect(mockTransport.endpoints).toHaveLength(0);
  });

  it('эндпоинт из модуля, не переданного в App, не регистрируется', async () => {
    const ForeignEndpoint = httpEndpoint({
      method: 'GET',
      path: '/foreign',
      handle: async () => new Ok({}),
    });

    makeAppModule({
      name: 'module:foreign',
      endpoints: [ForeignEndpoint],
    });

    const mockTransport = new MockTransport();

    const app = new App({
      transports: { http: mockTransport },
      modules: [], // модуль с эндпоинтом не зарегистрирован
    });

    // Старт проходит, транспорт пуст: импорт файла ни на что не влияет
    await app.run();

    expect(mockTransport.endpoints).toHaveLength(0);

    await app.close();
  });

  it('требуемый, но не переданный транспорт — ошибка старта', async () => {
    const CliEndpoint = makeEndpoint({
      transport: 'cli',
      pattern: 'users:list',
      handle: async () => new Ok({}),
    });

    const CliModule = makeAppModule({
      name: 'module:cli',
      endpoints: [CliEndpoint],
    });

    const mockTransport = new MockTransport();

    const app = new App({
      transports: { http: mockTransport },
      modules: [CliModule],
    });

    await expect(app.run()).rejects.toThrow(
      /Transport 'cli'.*users:list.*module:cli/s,
    );
    expect(mockTransport.endpoints).toHaveLength(0);
  });

  it('транспорт без обнаруженных ручек поднимается', async () => {
    const mockTransport = new MockTransport();

    const app = new App({
      transports: { http: mockTransport },
      modules: [makeAppModule({ name: 'module:empty' })],
    });

    await app.run();

    expect(mockTransport.listening).toBe(true);
    expect(mockTransport.endpoints).toHaveLength(0);

    await app.close();
  });

  it('гасит deps контейнером: хендлер получает инстанс из DI', async () => {
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

    const TestModule = makeAppModule({
      name: 'test-module',
      providers: [TestService],
      endpoints: [DataEndpoint],
    });

    const mockTransport = new MockTransport();

    const app = new App({
      transports: {
        http: mockTransport,
      },
      modules: [TestModule],
    });

    await app.run();

    expect(mockTransport.endpoints).toHaveLength(1);

    const handler = mockTransport.endpoints[0].handle;
    const result = await handler({}, { signal: new AbortController().signal });
    expect((result as Ok<unknown>).value).toEqual({ data: 'service-data' });

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

    const TestModule = makeAppModule({
      name: 'test-module',
      providers: [Greeter, GreetHandler],
      endpoints: [Greet],
    });

    const mockTransport = new MockTransport();
    const app = new App({
      transports: { http: mockTransport },
      modules: [TestModule],
    });

    await app.run();

    const handler = mockTransport.endpoints[0].handle;
    const result = await handler({}, { signal: new AbortController().signal });
    expect((result as Ok<unknown>).value).toEqual({ greeting: 'hi' });

    await app.close();
  });

  it('close() останавливает транспорты до уничтожения контейнера', async () => {
    const order: string[] = [];

    @Injectable([])
    class OrderHandler {
      async handle() {
        return new Ok({});
      }

      @OnDestroy()
      destroy() {
        order.push('container-destroyed');
      }
    }

    const TestModule = makeAppModule({
      name: 'test-module',
      providers: [OrderHandler],
      endpoints: [
        httpEndpoint({
          method: 'GET',
          path: '/order',
          handle: OrderHandler,
        }),
      ],
    });

    const mockTransport = new MockTransport(() =>
      order.push('transport-closed'),
    );

    const app = new App({
      transports: {
        http: mockTransport,
      },
      modules: [TestModule],
    });

    await app.run();
    await app.close();

    expect(mockTransport.closed).toBe(true);
    expect(order).toEqual(['transport-closed', 'container-destroyed']);
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

    const TestModule = makeAppModule({
      name: 'test-module',
      providers: [WaitHandler],
      endpoints: [
        httpEndpoint({
          method: 'GET',
          path: '/wait',
          handle: WaitHandler,
        }),
      ],
    });

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

    const app = new App({
      transports: {
        http: httpTransport,
      },
      modules: [TestModule],
    });

    await app.run();

    const server = (httpTransport as unknown as { server: Server }).server;
    const { port } = server.address() as AddressInfo;

    const pending = fetch(`http://127.0.0.1:${port}/wait`).catch(() => null);
    await started;

    await app.close();

    const reason = await aborted;
    expect((reason as Error).message).toBe('transport closing');
    expect(order).toEqual(['transport-closed', 'container-destroyed']);

    await pending;
  });

  it('резолвит классы-юниты пайплайна контейнером на старте (bind)', async () => {
    @Injectable([])
    class WithTracing {
      handle(): { traceId: string } {
        return { traceId: 'trace-from-di' };
      }
    }

    const TracedEndpoint = httpEndpoint({
      method: 'GET',
      path: '/traced',
      pipeline: makePipeline().pre(WithTracing),
      handle: async () => new Ok({}),
    });

    const TestModule = makeAppModule({
      name: 'test-module',
      providers: [WithTracing],
      endpoints: [TracedEndpoint],
    });

    const mockTransport = new MockTransport();
    const app = new App({
      transports: { http: mockTransport },
      modules: [TestModule],
    });

    await app.run();

    const pipeline = mockTransport.endpoints[0]?.pipeline;
    expect(pipeline).toBeDefined();
    if (!pipeline) {
      throw new Error('pipeline не зарегистрирован');
    }

    // Пайплайн пришёл в транспорт уже исполнимым: юнит зарезолвлен из DI
    const ctx = makeEmptyContext(
      {
        transport: 'http',
        pattern: 'GET /traced',
        payload: undefined,
        attributes: {},
      },
      { transport: 'http', pattern: 'GET /traced' },
    );
    const response = await pipeline.executeWithHandler(
      (_payload: unknown, meta: Record<string, unknown>) =>
        new Ok({ traceId: meta.traceId }),
      ctx as ExtendableContext<AnyInput>,
    );

    expect(response).toMatchObject({
      isSuccess: true,
      value: { traceId: 'trace-from-di' },
    });

    await app.close();
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

    const TestModule = makeAppModule({
      name: 'test-module',
      endpoints: [BrokenEndpoint],
    });

    const mockTransport = new MockTransport();
    const app = new App({
      transports: { http: mockTransport },
      modules: [TestModule],
    });

    await expect(app.run()).rejects.toThrow(
      /Dependency 'UnregisteredUnit'.*GET \/broken.*not available in the DI container/s,
    );
    expect(mockTransport.endpoints).toHaveLength(0);
  });

  it('элемент endpoints: без бренда — ошибка старта', async () => {
    const SmugglingModule = {
      ...makeModule({ name: 'module:smuggling' }),
      endpoints: [{ transport: 'http', pattern: 'GET /smuggled' }],
    };

    const mockTransport = new MockTransport();

    const app = new App({
      transports: { http: mockTransport },
      modules: [SmugglingModule],
    });

    await expect(app.run()).rejects.toThrow(
      /module:smuggling.*index 0.*not an endpoint declaration/s,
    );
    expect(mockTransport.endpoints).toHaveLength(0);
  });
});
