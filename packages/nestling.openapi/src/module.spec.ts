/**
 * Модуль-издатель: точка построения, топология и подчинение политикам.
 *
 * Главное здесь — **когда** строится документ. Обещана гарантия на старте:
 * непокрытая схема роняет старт до `serve`, а не при первом
 * запросе `/openapi.json`. Проверяется это наблюдаемо: конструкторы с
 * ресурсами не отработали, а транспорт не начал принимать запросы.
 */

import { makeOpenapi, OpenApiDocument$ } from './module.js';
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
  RouteDeclaration,
  TransportCapabilities,
} from '@nestlingjs/app';
import {
  compose,
  everyEndpoint,
  makeApp,
  makeEmptyContext,
  makeFeature,
  makePipeline,
  Ok,
  transportValue,
} from '@nestlingjs/app';
import {
  factoryProvider,
  makeSwitch,
  makeToken,
  resourceProvider,
} from '@nestlingjs/container';
import type { StandardSchemaV1 } from '@nestlingjs/operations';
import { zodConverter } from '@nestlingjs/schema.zod';
import { httpEndpoint, HttpTransport$ } from '@nestlingjs/transport.http';
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

/**
 * Пустой стартовый контекст: документ отдаётся endpoint'ом без входа.
 *
 * Объявленные исходы берутся с маршрута — их переносит транспорт, и без
 * них рантайм ответил бы статусом умолчания.
 */
const contextFor = (pattern: string, route?: RouteDeclaration) =>
  makeEmptyContext(
    { transport: 'http', pattern, payload: undefined, attributes: {} },
    {
      transport: 'http',
      pattern,
      output: route?.output,
      status: route?.status,
    },
  ) as ExtendableContext<AnyInput>;

/** Документ, полученный вызовом собственного endpoint'а модуля */
const serve = async (transport: SpyTransport): Promise<OpenApiDocument> => {
  const route = transport.dispatch?.routes.find(
    (declaration) => declaration.pattern === 'GET /openapi.json',
  );

  const response = await transport.dispatch?.call(
    'GET /openapi.json',
    contextFor('GET /openapi.json', route),
  );

  if (!response?.isSuccess) {
    throw new Error(`GET /openapi.json failed: ${JSON.stringify(response)}`);
  }

  return response.value as OpenApiDocument;
};

const User = z.object({ id: z.string(), email: z.string() });

const GetUser = httpEndpoint.get('/users/:id', {
  input: z.object({ id: z.string() }),
  output: User,
  doc: { summary: 'Get user', tags: ['users'] },
  handler: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
});

const Health = httpEndpoint.get('/health', {
  output: z.object({ status: z.string() }),
  doc: { hidden: 'liveness-проба балансировщика' },
  handler: async () => new Ok({ status: 'up' }),
});

const UsersModule = makeFeature({
  name: 'module:openapi-users',
  endpoints: [GetUser, Health],
});

const ListInvoices = httpEndpoint.get('/invoices', {
  output: z.array(z.object({ id: z.string() })),
  handler: async () => new Ok([]),
});

const BillingModule = makeFeature({
  name: 'module:openapi-billing',
  endpoints: [ListInvoices],
});

const UsersFeature = UsersModule;
const BillingFeature = BillingModule;

describe('документ строит объявленный плагин', () => {
  it('метод строит документ при выключенной ветке переключателя', () => {
    const Docs = makeSwitch('docs', { default: 'on' });
    const openapi = makeOpenapi({ info, announceHidden: false });

    const app = makeApp({
      features: [UsersModule],
      plugins: [Docs.when(openapi)],
      switches: [Docs],
      transports: [asHttpTransport(new SpyTransport())],
    });

    const document = openapi.document(app.discover({ docs: 'off' }));

    expect(document.openapi).toBe('3.1.0');
    expect(document.info).toEqual(info);
    expect(Object.keys(document.paths)).toEqual(['/users/{id}']);
  });

  it('тело GET /openapi.json равно документу, построенному методом', async () => {
    const openapi = makeOpenapi({ info, announceHidden: false });
    const transport = new SpyTransport();

    const declaration = makeApp({
      features: [UsersModule],
      plugins: [openapi],
      transports: [asHttpTransport(transport)],
    });

    const app = declaration.build();
    await app.run();

    expect(await serve(transport)).toEqual(
      openapi.document(declaration.discover()),
    );

    await app.close();
  });
});

describe('makeOpenapi(...) — плагин-издатель', () => {
  it('announceHidden пишет info на каждый скрытый endpoint', async () => {
    const spy = spyLogger();
    const app = makeApp({
      features: [UsersModule],
      plugins: [makeOpenapi({ info, converters: [zodConverter()] })],
      transports: [asHttpTransport(new SpyTransport())],
      logging: { logger: spy.logger },
    }).build();

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
      // Собственный endpoint документа тоже скрыт — и тоже назван в записи
      {
        level: 'info',
        message: 'hidden from the API document',
        fields: {
          scope: 'nestling:openapi',
          pattern: 'GET /openapi.json',
          module: '@nestlingjs/openapi',
          reason: 'service endpoint: the document itself',
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
        makeOpenapi({
          info,
          converters: [zodConverter()],
          announceHidden: false,
        }),
      ],
      transports: [asHttpTransport(new SpyTransport())],
      logging: { logger: spy.logger },
    }).build();

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
        makeOpenapi({
          info,
          converters: [zodConverter()],
          announceHidden: false,
        }),
      ],
      transports: [asHttpTransport(transport)],
    }).build();

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

    const Exotic = httpEndpoint.post('/exotic', {
      input: exotic,
      output: z.unknown(),
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
        makeOpenapi({
          info,
          converters: [zodConverter()],
          announceHidden: false,
        }),
      ],
      transports: [asHttpTransport(transport)],
    }).build();

    await expect(app.run()).rejects.toThrow(/cannot be documented/);

    // Документ строит провайдер, а провайдеры выполняются на INIT: старт
    // падает до приёма запросов, но после захвата ресурсов графа —
    // поэтому захваченное освобождается откатом
    expect(acquired).toBe(true);
    expect(released).toBe(true);
    expect(transport.serving).toBe(false);

    await app.close();
  });

  it('без списка конвертеров документ строится: умолчание есть', async () => {
    const transport = new SpyTransport();
    const app = makeApp({
      features: [UsersModule],
      plugins: [makeOpenapi({ info, announceHidden: false })],
      transports: [asHttpTransport(transport)],
    }).build();

    await app.run();

    const document = await serve(transport);

    expect(
      document.paths['/users/{id}']?.get?.responses['200']?.content?.[
        'application/json'
      ]?.schema,
    ).toMatchObject({ type: 'object' });

    await app.close();
  });

  it('схема чужого вендора роняет сборку, называя вендора', async () => {
    /** Схема вендора, которого список конвертеров не знает */
    const foreign: StandardSchemaV1<unknown, { id: string }> = {
      '~standard': {
        version: 1,
        vendor: 'valibot',
        validate: (value: unknown) => ({ value: value as { id: string } }),
      },
    };

    const Foreign = httpEndpoint.get('/foreign', {
      output: foreign,
      handler: async () => new Ok({ id: 'x' }),
    });

    const app = makeApp({
      features: [makeFeature({ name: 'module:foreign', endpoints: [Foreign] })],
      plugins: [makeOpenapi({ info, announceHidden: false })],
      transports: [asHttpTransport(new SpyTransport())],
    }).build();

    await expect(app.run()).rejects.toThrow(/vendor 'valibot'/);

    await app.close();
  });

  it('невыбранная фича в документе отсутствует', async () => {
    const transport = new SpyTransport();
    const app = makeApp({
      features: [UsersFeature, BillingFeature],
      plugins: [
        makeOpenapi({
          info,
          converters: [zodConverter()],
          announceHidden: false,
        }),
      ],
      transports: [asHttpTransport(transport)],
    }).build('module:openapi-users');

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

  const Traced = httpEndpoint.get('/traced', {
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
        makeOpenapi({
          info,
          converters: [zodConverter()],
          pipeline: observability,
          announceHidden: false,
        }),
      ],
      transports: [asHttpTransport(new SpyTransport())],
      policies: [policy],
    }).build();

    await expect(app.run()).resolves.toBeUndefined();
    await app.close();
  });

  it('без pipeline и без detached — нарушение политики', async () => {
    const app = makeApp({
      features: [TracedModule],
      plugins: [
        makeOpenapi({
          info,
          converters: [zodConverter()],
          announceHidden: false,
        }),
      ],
      transports: [asHttpTransport(new SpyTransport())],
      policies: [policy],
    }).build();

    await expect(app.run()).rejects.toThrow(/GET \/openapi\.json/);
    await app.close();
  });

  it('detached снимает endpoint с политики', async () => {
    const app = makeApp({
      features: [TracedModule],
      plugins: [
        makeOpenapi({
          info,
          converters: [zodConverter()],
          detached: 'служебная ручка документации',
          announceHidden: false,
        }),
      ],
      transports: [asHttpTransport(new SpyTransport())],
      policies: [policy],
    }).build();

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
        makeOpenapi({
          info,
          converters: [zodConverter()],
          announceHidden: false,
        }),
      ],
      transports: [asHttpTransport(transport)],
    }).build();

    await app.run();

    // Документ построен на BUILD и лежит в графе значением: endpoint —
    // способ его отдать, а не место, где он появляется
    expect(injected).toEqual(await serve(transport));
    expect(Object.keys(injected?.paths ?? {})).toEqual(['/users/{id}']);

    await app.close();
  });
});
