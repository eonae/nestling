/**
 * `App.check()` — структурный смок на фазах 0–1 и внутренний шов фаз 0–3.
 *
 * Оба режима проверяются одним и тем же наблюдением: что выполнилось, что
 * не выполнилось и какими ошибками падает то, что не сходится.
 */

import { wireApp } from './testing/index.js';
import { makeApp } from './app.js';
import { makeFeature } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it, jest } from '@jest/globals';
import {
  Injectable,
  makeToken,
  OnDestroy,
  OnInit,
  OnStart,
} from '@nestling/container';
import { makeCommand, makeEvent, makeRequest } from '@nestling/operations';
import type { SchemaDocConverter } from '@nestling/pipeline';
import { makeEndpoint, makeFail, Ok } from '@nestling/pipeline';
import { implement } from '@nestling/ports';
import type { ITransport } from '@nestling/transport';
import { transportValue } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

const asHttpTransport = (transport: ITransport) =>
  transportValue(HttpTransport$('default'), transport);

/** Конвертер-фикстура: те же десять строк, что показывает гайд */
const zodConverter = (): SchemaDocConverter => ({
  vendor: 'zod',
  toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
});

const CardDeclined = makeFail('payment_required:card_declined', {
  message: 'Card declined',
});

describe('App.check() — фазы 0–1', () => {
  it('строит граф, не выполняя @OnInit и не начиная принимать запросы', async () => {
    const events: string[] = [];

    @Injectable([])
    class Connection {
      constructor() {
        events.push('constructed');
      }

      @OnInit()
      open(): void {
        events.push('init');
      }

      @OnStart()
      go(): void {
        events.push('start');
      }

      @OnDestroy()
      close(): void {
        events.push('destroy');
      }
    }

    const transport = new MockTransport();
    const report = await makeApp({
      features: [
        makeFeature({ name: 'module:resource', providers: [Connection] }),
      ],
      transports: [asHttpTransport(transport)],
    }).check();

    expect(events).toEqual(['constructed']);
    expect(transport.serving).toBe(false);
    expect(report.transports).toEqual(['http']);
  });

  it('падает той же ошибкой, что и run()', async () => {
    const CliTransport$ = makeToken<ITransport>('transport:cli');
    const Orphan = makeEndpoint({
      transport: CliTransport$,
      pattern: 'orphan',
      handler: async () => new Ok({}),
    });

    const spec = {
      features: [makeFeature({ name: 'module:cli', endpoints: [Orphan] })],
      transports: [asHttpTransport(new MockTransport())],
    };

    await expect(makeApp(spec).check()).rejects.toThrow(
      /Transport 'cli'.*module:cli.*'transports:'/s,
    );
    await expect(makeApp(spec).assemble().run()).rejects.toThrow(
      /Transport 'cli'.*module:cli.*'transports:'/s,
    );
  });

  it("называет выбранные фичи и обнаруженные endpoint'ы с транспортами", async () => {
    const Logging = makeFeature({
      name: 'logging',
    });

    const Users = makeFeature({
      name: 'users',
      endpoints: [
        httpEndpoint({
          method: 'GET',
          path: '/users',
          handler: async () => new Ok({}),
        }),
      ],
    });

    const report = await makeApp({
      features: [Users, Logging],
      transports: [asHttpTransport(new MockTransport())],
    }).check('users');

    // Выбор строгий: `logging` не подтягивается ничем — поля `dependsOn`
    // у фичи нет
    expect(report.features).toEqual(['users']);
    expect(report.endpoints).toEqual([
      { pattern: 'GET /users', transport: 'http', module: 'users' },
    ]);
  });

  it('не мешает последующему run() того же приложения', async () => {
    const inits: string[] = [];

    @Injectable([])
    class Service {
      @OnInit()
      open(): void {
        inits.push('init');
      }
    }

    const transport = new MockTransport();
    const app = makeApp({
      features: [
        makeFeature({
          name: 'module:service',
          providers: [Service],
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/ping',
              handler: async () => new Ok({}),
            }),
          ],
        }),
      ],
      transports: [asHttpTransport(transport)],
    });

    await app.check();
    expect(inits).toEqual([]);

    const assembled = app.assemble();
    await assembled.run();

    expect(inits).toEqual(['init']);
    expect(transport.routes.map((route) => route.pattern)).toEqual([
      'GET /ping',
    ]);

    await assembled.close();
  });
});

describe('App.check() — опубликованные операции в отчёте', () => {
  const ChargeCard = makeRequest({
    name: 'check.billing.charge',
    input: z.object({ amount: z.number() }),
    output: z.object({ chargeId: z.string() }),
    errors: [CardDeclined],
  });

  /** Операция, которая импортирована, но этой сборкой не реализуется */
  const NeverImplemented = makeCommand({
    name: 'check.billing.refund',
    input: z.object({ chargeId: z.string() }),
  });

  const billingModule = makeFeature({
    name: 'billing',
    endpoints: [
      implement(ChargeCard, {
        handler: async () => new Ok({ chargeId: 'c-1' }),
      }),
    ],
  });

  const assembleBilling = () =>
    makeApp({
      features: [billingModule],
      transports: [asHttpTransport(new MockTransport())],
    });

  it('несёт дескриптор с видом, формами и кодами отказов', async () => {
    const report = await assembleBilling().check(undefined, {
      converters: [zodConverter()],
    });

    expect(report.published).toHaveLength(1);

    const [descriptor] = report.published;

    expect(descriptor.name).toBe('check.billing.charge');
    expect(descriptor.kind).toBe('request');
    expect(descriptor.errors).toEqual([
      { code: 'payment_required:card_declined', category: 'payment_required' },
    ]);
    expect(descriptor.output.leaf).toMatchObject({
      leaf: 'schema',
      vendor: 'zod',
      jsonSchema: { properties: { chargeId: { type: 'string' } } },
    });
  });

  it('без конвертеров даёт ту же структурную часть и непрозрачные листья', async () => {
    const report = await assembleBilling().check();

    const [descriptor] = report.published;

    expect(descriptor.kind).toBe('request');
    expect(descriptor.errors).toHaveLength(1);
    expect(descriptor.input.leaf).toEqual({ leaf: 'opaque', vendor: 'zod' });
  });

  it('импортированная, но не реализованная операция в отчёт не попадает', async () => {
    const report = await assembleBilling().check();

    // Значение импортировано этим файлом и лежит в приватном реестре
    // пакета — но приложение его не публикует, и отчёт это знает
    expect(NeverImplemented.name).toBe('check.billing.refund');
    expect(report.published.map(({ name }) => name)).toEqual([
      'check.billing.charge',
    ]);
  });

  it('у приложения без операций поле пусто, а не отсутствует', async () => {
    const report = await makeApp({
      features: [
        makeFeature({
          name: 'module:http-only',
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/ping',
              handler: async () => new Ok({}),
            }),
          ],
        }),
      ],
      transports: [asHttpTransport(new MockTransport())],
    }).check();

    expect(report.published).toEqual([]);
  });

  it('событие с двумя подписчиками даёт один дескриптор', async () => {
    const OrderPlaced = makeEvent({
      name: 'check.orders.placed',
      input: z.object({ orderId: z.string() }),
    });

    const report = await makeApp({
      features: [
        makeFeature({
          name: 'module:orders',
          endpoints: [
            implement(OrderPlaced, {
              subscriber: 'billing',
              handler: async () => new Ok(undefined),
            }),
            implement(OrderPlaced, {
              subscriber: 'analytics',
              handler: async () => new Ok(undefined),
            }),
          ],
        }),
      ],
      transports: [asHttpTransport(new MockTransport())],
    }).check();

    expect(report.published.map(({ name }) => name)).toEqual([
      'check.orders.placed',
    ]);
    expect(report.published[0].kind).toBe('event');
  });

  it('не выполняет @OnInit и не влияет на последующий run()', async () => {
    const app = assembleBilling();

    const first = await app.check(undefined, { converters: [zodConverter()] });
    const second = await app.check(undefined, { converters: [zodConverter()] });

    // Отчёт — значение: два прогона на одном графе равны как значения
    expect(second.operations).toEqual(first.operations);
  });
});

describe('шов @nestling/app/testing — фазы 0–3', () => {
  it('доводит до WIRE и останавливается', async () => {
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
      handler: async () => new Ok({ pong: true }),
    });

    const transport = new MockTransport();
    const before = process.listenerCount('SIGTERM');
    const log = jest
      .spyOn(console, 'log')
      .mockImplementation((): void => undefined);

    try {
      const wired = await wireApp(
        makeApp({
          features: [
            makeFeature({
              name: 'module:service',
              providers: [Service],
              endpoints: [Ping],
            }),
          ],
          transports: [asHttpTransport(transport)],
        }),
      );

      expect(events).toEqual(['init']);
      expect(transport.serving).toBe(false);
      expect(process.listenerCount('SIGTERM')).toBe(before);
      expect(log).not.toHaveBeenCalled();

      // Endpoint адресуется идентичностью декларации, а не строкой паттерна
      const endpoint = wired.endpoints.get(Ping);
      expect(endpoint?.moduleName).toBe('module:service');
      expect(endpoint?.dispatch.routes.map((route) => route.pattern)).toEqual([
        'GET /ping',
      ]);

      await wired.close();
    } finally {
      log.mockRestore();
    }
  });

  it('проводит подстановку и отдаёт список выпавших узлов', async () => {
    const IPool = makeToken<{ query(): string }>('SeamPool');
    const IRepository = makeToken<{ find(): string }>('SeamRepository');

    @Injectable(IPool, [])
    class PgPool {
      query(): string {
        return 'real';
      }
    }

    @Injectable(IRepository, [IPool])
    class PgRepository {
      constructor(private readonly pool: { query(): string }) {}

      find(): string {
        return this.pool.query();
      }
    }

    const wired = await wireApp(
      makeApp({
        features: [
          makeFeature({
            name: 'module:data',
            providers: [PgPool, PgRepository],
          }),
        ],
      }),
      {
        overrides: [[IRepository, { find: () => 'fake' }]],
      },
    );

    expect(wired.container.getOrThrow(IRepository).find()).toBe('fake');
    expect(wired.container.pruned).toEqual(['SeamPool']);

    await wired.close();
  });

  it('взводит общий сигнал и выполняет @OnDestroy на close()', async () => {
    const events: string[] = [];

    @Injectable([])
    class Service {
      @OnDestroy()
      stop(): void {
        events.push('destroy');
      }
    }

    const wired = await wireApp(
      makeApp({
        features: [
          makeFeature({ name: 'module:service', providers: [Service] }),
        ],
      }),
    );

    wired.signal.addEventListener('abort', () => events.push('aborted'));

    await wired.close();
    await wired.close();

    expect(events).toEqual(['aborted', 'destroy']);
  });
});
