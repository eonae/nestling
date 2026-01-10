import { App } from './app';
import { MockTransport } from './helpers';
import { makeAppModule } from './module';

import { beforeEach, describe, expect, it } from '@jest/globals';
import { Injectable } from '@nestling/container';
import type { IEndpoint } from '@nestling/pipeline';
import {
  clearEndpointRegistry,
  clearMiddlewareRegistry,
  Endpoint,
  Ok,
} from '@nestling/pipeline';
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
    class TestEndpoint
      implements IEndpoint<{ id: string }, {}, { result: string }>
    {
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
    class BadEndpoint implements IEndpoint<unknown, {}, {}> {
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
    class DataEndpoint implements IEndpoint<unknown, {}, { data: string }> {
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
        http: mockTransport as any,
      },
      modules: [TestModule],
    });

    await app.run();

    // Assert: endpoint зарегистрирован
    expect(mockTransport.endpoints).toHaveLength(1);

    // Проверяем, что handler работает с DI
    const handler = mockTransport.endpoints[0].handle;
    const result = await handler({}, {});
    expect((result as Ok<unknown>).value).toHaveProperty('data');

    // Cleanup
    await app.close();
  });
});
