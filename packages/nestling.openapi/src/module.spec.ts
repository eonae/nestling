/**
 * Модуль-издатель: точка построения, топология и подчинение политикам.
 *
 * Главное здесь — **когда** строится документ. Обещана гарантия на старте:
 * непокрытая схема роняет старт до `serve`, а не при первом
 * запросе `/openapi.json`. Проверяется это наблюдаемо: конструкторы с
 * ресурсами не отработали, а транспорт не начал принимать запросы.
 */

import { openapi, OpenApiDocument$ } from './module.js';
import type { OpenApiDocument } from './types.js';

import { describe, expect, it } from '@jest/globals';
import type {
  AnyInput,
  Dispatch,
  ExtendableContext,
  Fields,
  ITransport,
  Logger,
  LogLevel,
  TransportCapabilities,
} from '@nestling/app';
import {
  compose,
  everyEndpoint,
  makeApp,
  makeEmptyContext,
  makeFeature,
  makePipeline,
  Ok,
  transportValue,
} from '@nestling/app';
import {
  factoryProvider,
  makeToken,
  resourceProvider,
} from '@nestling/container';
import { zodConverter } from '@nestling/openapi.zod';
import type { StandardSchemaV1 } from '@nestling/operations';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

/** Логгер-шпион: записи ядра копятся значениями, а не уходят в stderr */
function spyLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const make = (bindings: Fields): Logger => {
    const write =
      (level: LogLevel) =>
      (first: string | Error | Fields, second?: Fields): void => {
        if (typeof first === 'string') {
          entries.push({
            level,
            message: first,
            fields: { ...bindings, ...second },
          });
        } else if (first instanceof Error) {
          entries.push({
            level,
            message: first.message,
            fields: { ...bindings, ...second, err: first },
          });
        } else {
          entries.push({
            level,
            message: '',
            fields: { ...bindings, ...first },
          });
        }
      };

    return {
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
      child: (extra) => make({ ...bindings, ...extra }),
    };
  };

  return { logger: make({}), entries };
}

interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: Fields;
}

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

  async serve(dispatch: Dispatch): Promise<void> {
    this.dispatch = dispatch;
    this.serving = true;
  }

  async close(): Promise<void> {
    this.serving = false;
  }
}

const asHttpTransport = (transport: ITransport) =>
  transportValue(HttpTransport$('default'), transport, {
    capabilities: VALUE_ONLY,
  });

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
  handler: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
});

const Health = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: z.object({ status: z.string() }),
  doc: { hidden: 'liveness-проба балансировщика' },
  handler: async () => new Ok({ status: 'up' }),
});

const UsersModule = makeFeature({
  name: 'module:openapi-users',
  endpoints: [GetUser, Health],
});

const ListInvoices = httpEndpoint({
  method: 'GET',
  path: '/invoices',
  output: z.array(z.object({ id: z.string() })),
  handler: async () => new Ok([]),
});

const BillingModule = makeFeature({
  name: 'module:openapi-billing',
  endpoints: [ListInvoices],
});

const UsersFeature = UsersModule;
const BillingFeature = BillingModule;

describe('openapi(...) — плагин-издатель', () => {
  it('announceHidden пишет info на каждый скрытый endpoint', async () => {
    const spy = spyLogger();
    const app = makeApp({
      features: [UsersModule],
      plugins: [openapi({ info, converters: [zodConverter()] })],
      transports: [asHttpTransport(new SpyTransport())],
      logger: spy.logger,
    }).assemble();

    await app.run();

    expect(
      spy.entries.filter(
        (entry) => entry.message === 'hidden from the API document',
      ),
    ).toEqual([
      {
        level: 'info',
        message: 'hidden from the API document',
        fields: {
          scope: 'nestling:openapi',
          pattern: 'GET /health',
          module: 'module:openapi-users',
          reason: 'liveness-проба балансировщика',
        },
      },
      // Собственная ручка документа тоже скрыта — и тоже названа в записи
      {
        level: 'info',
        message: 'hidden from the API document',
        fields: {
          scope: 'nestling:openapi',
          pattern: 'GET /openapi.json',
          module: '@nestling/openapi',
          reason: 'служебная ручка: сам документ',
        },
      },
    ]);

    await app.close();
  });

  it('announceHidden: false не даёт ни одной записи', async () => {
    const spy = spyLogger();
    const app = makeApp({
      features: [UsersModule],
      plugins: [
        openapi({ info, converters: [zodConverter()], announceHidden: false }),
      ],
      transports: [asHttpTransport(new SpyTransport())],
      logger: spy.logger,
    }).assemble();

    await app.run();

    expect(
      spy.entries.filter(
        (entry) => entry.message === 'hidden from the API document',
      ),
    ).toEqual([]);

    await app.close();
  });

  it("отдаёт документ endpoint'ом и не описывает сам себя", async () => {
    const transport = new SpyTransport();
    const app = makeApp({
      features: [UsersModule],
      plugins: [
        openapi({ info, converters: [zodConverter()], announceHidden: false }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

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

  it('непокрытая схема роняет старт на INIT — до приёма запросов', async () => {
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
      handler: async () => new Ok({ ok: true }),
    });

    let acquired = false;
    let released = false;

    const Pool$ = makeToken<{ open: true }>('Pool');
    const pool = resourceProvider(Pool$, {
      deps: [] as const,
      acquire: () => {
        acquired = true;

        return { open: true as const };
      },
      release: () => {
        released = true;
      },
    });

    const transport = new SpyTransport();
    const app = makeApp({
      features: [
        makeFeature({
          name: 'module:exotic',
          providers: [pool],
          endpoints: [Exotic],
        }),
      ],
      plugins: [
        openapi({ info, converters: [zodConverter()], announceHidden: false }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await expect(app.run()).rejects.toThrow(/cannot be documented/);

    // Документ строит провайдер, а провайдеры выполняются на INIT: старт
    // падает до приёма запросов, но после захвата ресурсов графа —
    // поэтому захваченное освобождается откатом
    expect(acquired).toBe(true);
    expect(released).toBe(true);
    expect(transport.serving).toBe(false);

    await app.close();
  });

  it('пустой список конвертеров тоже роняет сборку, а не строит документ без схем', async () => {
    const app = makeApp({
      features: [UsersModule],
      plugins: [openapi({ info, announceHidden: false })],
      transports: [asHttpTransport(new SpyTransport())],
    }).assemble();

    await expect(app.run()).rejects.toThrow(/no converter for that vendor/);

    await app.close();
  });

  it('невыбранная фича в документе отсутствует', async () => {
    const transport = new SpyTransport();
    const app = makeApp({
      features: [UsersFeature, BillingFeature],
      plugins: [
        openapi({ info, converters: [zodConverter()], announceHidden: false }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble('module:openapi-users');

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
    handler: async () => new Ok({ ok: true }),
  });

  const TracedModule = makeFeature({
    name: 'module:traced',
    endpoints: [Traced],
  });

  it('с переданным pipeline сборка проходит', async () => {
    const app = makeApp({
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
    }).assemble();

    await expect(app.run()).resolves.toBeUndefined();
    await app.close();
  });

  it('без pipeline и без detached — нарушение политики', async () => {
    const app = makeApp({
      features: [TracedModule],
      plugins: [
        openapi({ info, converters: [zodConverter()], announceHidden: false }),
      ],
      transports: [asHttpTransport(new SpyTransport())],
      policies: [policy],
    }).assemble();

    await expect(app.run()).rejects.toThrow(/GET \/openapi\.json/);
    await app.close();
  });

  it('detached снимает endpoint с политики', async () => {
    const app = makeApp({
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
    }).assemble();

    await expect(app.run()).resolves.toBeUndefined();
    await app.close();
  });
});

describe('документ доступен значением', () => {
  it('DI-токен OpenApiDocument$ отдаёт тот же документ, что и endpoint', async () => {
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
    const app = makeApp({
      features: [UsersModule, ObserverModule],
      plugins: [
        openapi({ info, converters: [zodConverter()], announceHidden: false }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await app.run();

    // Документ построен на ASSEMBLE и лежит в графе значением: endpoint —
    // способ его отдать, а не место, где он появляется
    expect(injected).toEqual(await serve(transport));
    expect(Object.keys(injected?.paths ?? {})).toEqual(['/users/{id}']);

    await app.close();
  });
});
