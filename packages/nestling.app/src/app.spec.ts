import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { App } from './app';
import { MockTransport } from './helpers';
import { makeAppModule } from './module';

import { describe, expect, it } from '@jest/globals';
import { Injectable, makeModule, OnDestroy } from '@nestling/container';
import type {
  AnyInput,
  ExtendableContext,
  IEndpoint,
} from '@nestling/pipeline';
import {
  Endpoint,
  makeEmptyContext,
  makePipeline,
  Ok,
} from '@nestling/pipeline';
import { HttpTransport } from '@nestling/transport.http';
import { z } from 'zod';

describe('App Integration', () => {
  it('should auto-discover and register endpoints from modules', async () => {
    // Arrange: создаём endpoint
    @Injectable([])
    @Endpoint({
      transport: 'http',
      pattern: 'GET /test',
      input: z.object({ id: z.string() }),
      output: z.object({ result: z.string() }),
    })
    class TestEndpoint implements IEndpoint {
      async handle(input: { id: string }) {
        return new Ok({ result: `test-${input.id}` });
      }
    }

    // Создаём модуль с endpoint
    const TestModule = makeAppModule({
      name: 'test-module',
      endpoints: [TestEndpoint],
    });

    const mockTransport = new MockTransport();

    // Act: создаём и инициализируем App
    const app = new App({
      transports: {
        http: mockTransport as any,
      },
      modules: [TestModule],
    });

    await app.run();

    // Assert: endpoint должен быть зарегистрирован
    expect(mockTransport.endpoints).toHaveLength(1);
    expect(mockTransport.endpoints[0].pattern).toBe('GET /test');

    // Cleanup
    await app.close();
  });

  it('объявленный в endpoints: эндпоинт обязан резолвиться контейнером', async () => {
    // Arrange: endpoint объявлен в модуле, но БЕЗ @Injectable
    @Endpoint({
      transport: 'http',
      pattern: 'GET /test',
    })
    class BadEndpoint implements IEndpoint {
      async handle() {
        return new Ok({});
      }
    }

    // Модуль собран вручную: контейнер эндпоинт не регистрирует,
    // дискавери его видит
    const BadModule = {
      ...makeModule({ name: 'module:bad' }),
      endpoints: [BadEndpoint],
    };

    const mockTransport = new MockTransport();

    // Act & Assert
    const app = new App({
      transports: {
        http: mockTransport,
      },
      modules: [BadModule],
    });

    await expect(app.run()).rejects.toThrow(
      /BadEndpoint.*module:bad.*not available in the DI container/s,
    );
    expect(mockTransport.endpoints).toHaveLength(0);
  });

  it('эндпоинт из модуля, не переданного в App, не регистрируется', async () => {
    // Arrange: класс декорирован и импортирован процессом, но его модуль
    // приложению не передан
    @Injectable([])
    @Endpoint({
      transport: 'http',
      pattern: 'GET /foreign',
    })
    class ForeignEndpoint implements IEndpoint {
      async handle() {
        return new Ok({});
      }
    }

    makeAppModule({
      name: 'module:foreign',
      endpoints: [ForeignEndpoint],
    });

    const mockTransport = new MockTransport();

    const app = new App({
      transports: { http: mockTransport },
      modules: [], // модуль с эндпоинтом не зарегистрирован
    });

    // Act & Assert: старт проходит, транспорт пуст
    await app.run();

    expect(mockTransport.endpoints).toHaveLength(0);

    await app.close();
  });

  it('требуемый, но не переданный транспорт — ошибка старта', async () => {
    @Injectable([])
    @Endpoint({
      transport: 'cli',
      pattern: 'users:list',
    })
    class CliEndpoint implements IEndpoint {
      async handle() {
        return new Ok({});
      }
    }

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

  it('endpoint-класс в providers мимо endpoints: — ошибка старта', async () => {
    @Injectable([])
    @Endpoint({
      transport: 'http',
      pattern: 'GET /smuggled',
    })
    class SmuggledEndpoint implements IEndpoint {
      async handle() {
        return new Ok({});
      }
    }

    const SmugglingModule = makeModule({
      name: 'module:smuggling',
      providers: [SmuggledEndpoint],
    });

    const mockTransport = new MockTransport();

    const app = new App({
      transports: { http: mockTransport },
      modules: [SmugglingModule],
    });

    await expect(app.run()).rejects.toThrow(
      /SmuggledEndpoint.*module:smuggling.*'endpoints:'/s,
    );
    expect(mockTransport.endpoints).toHaveLength(0);
  });

  it('should support endpoints with DI', async () => {
    // Arrange: сервис
    @Injectable([])
    class TestService {
      getData() {
        return 'service-data';
      }
    }

    // Endpoint с зависимостью
    @Injectable([TestService])
    @Endpoint({
      transport: 'http',
      pattern: 'GET /data',
    })
    class DataEndpoint implements IEndpoint {
      constructor(private service: TestService) {}

      async handle() {
        const data = this.service.getData();
        return new Ok({ data });
      }
    }

    const TestModule = makeAppModule({
      name: 'test-module',
      providers: [TestService],
      endpoints: [DataEndpoint],
    });

    const mockTransport = new MockTransport();

    // Act
    const app = new App({
      transports: {
        http: mockTransport,
      },
      modules: [TestModule],
    });

    await app.run();

    // Assert: endpoint зарегистрирован
    expect(mockTransport.endpoints).toHaveLength(1);

    // Проверяем, что handler работает с DI
    const handler = mockTransport.endpoints[0].handle;
    const result = await handler({}, { signal: new AbortController().signal });
    expect((result as Ok<unknown>).value).toHaveProperty('data');

    // Cleanup
    await app.close();
  });

  it('close() останавливает транспорты до уничтожения контейнера', async () => {
    const order: string[] = [];

    @Injectable([])
    @Endpoint({
      transport: 'http',
      pattern: 'GET /order',
    })
    class OrderEndpoint implements IEndpoint {
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
      endpoints: [OrderEndpoint],
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
    @Endpoint({
      transport: 'http',
      pattern: 'GET /wait',
    })
    class WaitEndpoint implements IEndpoint {
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
      endpoints: [WaitEndpoint],
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

    @Injectable([])
    @Endpoint({
      transport: 'http',
      pattern: 'GET /traced',
      pipeline: makePipeline().pre(WithTracing),
    })
    class TracedEndpoint implements IEndpoint {
      async handle() {
        return new Ok({});
      }
    }

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

    @Injectable([])
    @Endpoint({
      transport: 'http',
      pattern: 'GET /broken',
      pipeline: makePipeline().pre(UnregisteredUnit),
    })
    class BrokenEndpoint implements IEndpoint {
      async handle() {
        return new Ok({});
      }
    }

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
      /Pipeline unit 'UnregisteredUnit'.*not available in the DI container/,
    );
    expect(mockTransport.endpoints).toHaveLength(0);
  });
});
