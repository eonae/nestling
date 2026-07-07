import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { App } from './app';
import { MockTransport } from './helpers';
import { makeAppModule } from './module';

import { beforeEach, describe, expect, it } from '@jest/globals';
import { Injectable, OnDestroy } from '@nestling/container';
import type { IEndpoint } from '@nestling/pipeline';
import {
  clearEndpointRegistry,
  clearMiddlewareRegistry,
  Endpoint,
  Ok,
} from '@nestling/pipeline';
import { HttpTransport } from '@nestling/transport.http';
import { z } from 'zod';

describe('App Integration', () => {
  beforeEach(() => {
    // Очищаем registry перед каждым тестом
    clearEndpointRegistry();
    clearMiddlewareRegistry();
  });

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

  it('should throw error if endpoint is in registry but not in container', async () => {
    // Arrange: создаём endpoint БЕЗ @Injectable
    @Endpoint({
      transport: 'http',
      pattern: 'GET /test',
    })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    class BadEndpoint implements IEndpoint {
      async handle() {
        return new Ok({});
      }
    }

    const mockTransport = new MockTransport();

    // Act & Assert
    const app = new App({
      transports: {
        http: mockTransport,
      },
      modules: [], // Не добавляем endpoint в модули
    });

    await expect(app.run()).rejects.toThrow(
      /not available in the DI container/,
    );
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
});
