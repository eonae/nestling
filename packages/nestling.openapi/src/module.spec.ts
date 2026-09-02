/**
 * Модуль-издатель: точка построения, топология и подчинение политикам.
 *
 * Главное здесь — **когда** строится документ. Обещана гарантия на старте:
 * непокрытая схема роняет сборку до `@OnInit` и до `serve`, а не при первом
 * запросе `/openapi.json`. Проверяется это наблюдаемо: конструкторы с
 * ресурсами не отработали, а транспорт не начал принимать запросы.
 */

import { openapi, OpenApiDocument$ } from './module.js';
import type { OpenApiDocument } from './types.js';

import { describe, expect, it } from '@jest/globals';
import { assemble, makeFeature } from '@nestling/app';
import { factoryProvider, makeToken, OnInit } from '@nestling/container';
import { zodConverter } from '@nestling/openapi.zod';
import type { StandardSchemaV1 } from '@nestling/operations';
import type {
  AnyInput,
  ExtendableContext,
  TransportCapabilities,
} from '@nestling/pipeline';
import {
  compose,
  everyEndpoint,
  makeEmptyContext,
  makePipeline,
  Ok,
} from '@nestling/pipeline';
import type { Dispatch, ITransport } from '@nestling/transport';
import { transportValue } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

const info = { title: 'Test API', version: '1.0.0' };

const VALUE_ONLY: TransportCapabilities = {
  input: new Set(['value'] as const),
  output: new Set(['value'] as const),
};

/**
 * Транспорт-шпион: единственное, что он умеет, — сообщить, что начал
 * принимать запросы
 */
class SpyTransport implements ITransport {
  serving = false;
  dispatch?: Dispatch;
  readonly capabilities = VALUE_ONLY;

  async serve(dispatch: Dispatch): Promise<void> {
    this.dispatch = dispatch;
    this.serving = true;
  }

  async close(): Promise<void> {
    this.serving = false;
  }
}

const asHttpTransport = (transport: ITransport) =>
  transportValue(HttpTransport$('default'), transport);

/** Пустой стартовый контекст: документ отдаётся endpoint'ом без входа */
const contextFor = (pattern: string) =>
  makeEmptyContext(
    { transport: 'http', pattern, payload: undefined, attributes: {} },
    { transport: 'http', pattern },
  ) as ExtendableContext<AnyInput>;

/** Документ, полученный вызовом собственного endpoint'а модуля */
const serve = async (transport: SpyTransport): Promise<OpenApiDocument> => {
  const response = await transport.dispatch?.call(
    'GET /openapi.json',
    contextFor('GET /openapi.json'),
  );

  if (!response?.isSuccess) {
    throw new Error(`GET /openapi.json failed: ${JSON.stringify(response)}`);
  }

  return response.value as OpenApiDocument;
};

const User = z.object({ id: z.string(), email: z.string() });

const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }),
  output: User,
  doc: { summary: 'Get user', tags: ['users'] },
  handle: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
});

const Health = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: z.object({ status: z.string() }),
  doc: { hidden: 'liveness-проба балансировщика' },
  handle: async () => new Ok({ status: 'up' }),
});

const UsersModule = makeFeature({
  name: 'module:openapi-users',
  endpoints: [GetUser, Health],
});

const ListInvoices = httpEndpoint({
  method: 'GET',
  path: '/invoices',
  output: z.array(z.object({ id: z.string() })),
  handle: async () => new Ok([]),
});

const BillingModule = makeFeature({
  name: 'module:openapi-billing',
  endpoints: [ListInvoices],
});

const UsersFeature = UsersModule;
const BillingFeature = BillingModule;

describe('openapi(...) — плагин-издатель', () => {
  it("отдаёт документ endpoint'ом и не описывает сам себя", async () => {
    const transport = new SpyTransport();
    const app = assemble({
      features: [UsersModule],
      plugins: [
        openapi({ info, converters: [zodConverter()], announceHidden: false }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await app.run();

    const route = transport.dispatch?.routes.find(
      (candidate) => candidate.pattern === 'GET /openapi.json',
    );
    expect(route).toBeDefined();

    const document = await serve(transport);

    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toEqual(['/users/{id}']);
    expect(document.paths['/openapi.json']).toBeUndefined();
    // Скрытый endpoint тоже не описан
    expect(document.paths['/health']).toBeUndefined();

    await app.close();
  });

  it('непокрытая схема роняет сборку на ASSEMBLE — до @OnInit и до приёма запросов', async () => {
    const exotic: StandardSchemaV1<unknown, { id: string }> = {
      '~standard': {
        version: 1,
        vendor: 'valibot',
        validate: (value) => ({ value: value as { id: string } }),
      },
    };

    const Exotic = httpEndpoint({
      method: 'POST',
      path: '/exotic',
      input: exotic,
      handle: async () => new Ok({ ok: true }),
    });

    let initialized = false;

    class Resource {
      @OnInit()
      open(): void {
        initialized = true;
      }
    }

    const transport = new SpyTransport();
    const app = assemble({
      features: [
        makeFeature({
          name: 'module:exotic',
          providers: [factoryProvider(Resource, () => new Resource(), [])],
          endpoints: [Exotic],
        }),
      ],
      plugins: [
        openapi({ info, converters: [zodConverter()], announceHidden: false }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await expect(app.run()).rejects.toThrow(/cannot be documented/);

    expect(initialized).toBe(false);
    expect(transport.serving).toBe(false);

    await app.close();
  });

  it('пустой список конвертеров тоже роняет сборку, а не строит документ без схем', async () => {
    const app = assemble({
      features: [UsersModule],
      plugins: [openapi({ info, announceHidden: false })],
      transports: [asHttpTransport(new SpyTransport())],
    });

    await expect(app.run()).rejects.toThrow(/no converter for that vendor/);

    await app.close();
  });

  it('невыбранная фича в документе отсутствует', async () => {
    const transport = new SpyTransport();
    const app = assemble({
      features: [UsersFeature, BillingFeature],
      select: 'module:openapi-users',
      plugins: [
        openapi({ info, converters: [zodConverter()], announceHidden: false }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await app.run();

    const document = await serve(transport);

    expect(Object.keys(document.paths)).toEqual(['/users/{id}']);

    await app.close();
  });
});

describe('endpoint документации подчиняется политикам приложения', () => {
  const observability = makePipeline().pre(() => ({ traced: true }));

  const policy = everyEndpoint({
    transport: HttpTransport$('default'),
  }).hasLayer(observability, 'observability');

  const Traced = httpEndpoint({
    method: 'GET',
    path: '/traced',
    output: z.object({ ok: z.boolean() }),
    pipeline: compose(observability, makePipeline<{ traced: boolean }>()),
    handle: async () => new Ok({ ok: true }),
  });

  const TracedModule = makeFeature({
    name: 'module:traced',
    endpoints: [Traced],
  });

  it('с переданным pipeline сборка проходит', async () => {
    const app = assemble({
      features: [TracedModule],
      plugins: [
        openapi({
          info,
          converters: [zodConverter()],
          pipeline: observability,
          announceHidden: false,
        }),
      ],
      transports: [asHttpTransport(new SpyTransport())],
      policies: [policy],
    });

    await expect(app.run()).resolves.toBeUndefined();
    await app.close();
  });

  it('без pipeline и без detached — нарушение политики', async () => {
    const app = assemble({
      features: [TracedModule],
      plugins: [
        openapi({ info, converters: [zodConverter()], announceHidden: false }),
      ],
      transports: [asHttpTransport(new SpyTransport())],
      policies: [policy],
    });

    await expect(app.run()).rejects.toThrow(/GET \/openapi\.json/);
    await app.close();
  });

  it('detached снимает endpoint с политики', async () => {
    const app = assemble({
      features: [TracedModule],
      plugins: [
        openapi({
          info,
          converters: [zodConverter()],
          detached: 'служебная ручка документации',
          announceHidden: false,
        }),
      ],
      transports: [asHttpTransport(new SpyTransport())],
      policies: [policy],
    });

    await expect(app.run()).resolves.toBeUndefined();
    await app.close();
  });
});

describe('документ доступен значением', () => {
  it('токен OpenApiDocument$ отдаёт тот же документ, что и endpoint', async () => {
    let injected: OpenApiDocument | undefined;

    const Observer$ = makeToken<'observed'>('spec:openapi-observer');

    const ObserverModule = makeFeature({
      name: 'module:openapi-observer',
      providers: [
        factoryProvider(
          Observer$,
          (document: OpenApiDocument) => {
            injected = document;
            return 'observed' as const;
          },
          [OpenApiDocument$],
        ),
      ],
    });

    const transport = new SpyTransport();
    const app = assemble({
      features: [UsersModule, ObserverModule],
      plugins: [
        openapi({ info, converters: [zodConverter()], announceHidden: false }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await app.run();

    // Документ построен на ASSEMBLE и лежит в графе значением: endpoint —
    // способ его отдать, а не место, где он появляется
    expect(injected).toEqual(await serve(transport));
    expect(Object.keys(injected?.paths ?? {})).toEqual(['/users/{id}']);

    await app.close();
  });
});
