/**
 * Корневой логгер приложения: опция корня, единый логгер на все фазы и
 * запрет второго объявления.
 */

import { logField, Logger$, RootLogger$ } from '../logger/index.js';
import type {
  AnyEndpointDefinition,
  AnyInput,
  ExtendableContext,
  PreStepFn,
} from '../pipeline/index.js';
import {
  contextVar,
  makeEmptyContext,
  makePipeline,
  Ok,
  withRequestId,
} from '../pipeline/index.js';
import { wireApp } from '../testing/index.js';
import { transportValue } from '../transport/index.js';

import { loggerProbe } from './__fixtures__/logger.js';
import {
  testEndpoint,
  TestTransport$,
  VALUE_ONLY,
} from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { makePlugin } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import {
  factoryProvider,
  makeSwitch,
  makeToken,
  valueProvider,
} from '@nestlingjs/container';
import type { Fields, Logger } from '@nestlingjs/logging';
import { z } from 'zod';

/** Объявляет готовый инстанс транспорта экземпляром по умолчанию */
const asTransport = (transport: MockTransport) =>
  transportValue(TestTransport$('default'), transport, {
    capabilities: VALUE_ONLY,
  });

/** Endpoint корня: сборке нужно что-то обнаружить */
const ping = () =>
  testEndpoint({
    method: 'GET',
    path: '/ping',
    output: z.object({ ok: z.boolean() }),
    handler: async () => new Ok({ ok: true }),
  });

/** Контекст, который построил бы транспорт для `GET /write` */
const contextFor = () =>
  makeEmptyContext(
    {
      transport: 'test',
      pattern: 'GET /write',
      payload: undefined,
      attributes: {},
    },
    { transport: 'test', pattern: 'GET /write' },
  ) as ExtendableContext<AnyInput>;

/** Поднимает приложение до WIRE, исполняет endpoint и отдаёт запись */
const recordOf = async (
  app: ReturnType<typeof makeApp>,
  endpoint: AnyEndpointDefinition,
  probe: ReturnType<typeof loggerProbe>,
): Promise<Fields | undefined> => {
  const wired = await wireApp(app);

  try {
    await wired.endpoints
      .get(endpoint)
      ?.dispatch.call('GET /write', contextFor());
  } finally {
    await wired.close();
  }

  return probe.entries.find(({ message }) => message === 'select')?.fields;
};

describe('логгер корня', () => {
  it('опция logger принимает записи фаз 0–1 и фазы RUN', async () => {
    const probe = loggerProbe();

    // Два разных DI-токена с одним идентификатором — повод для предупреждения
    // контейнера на фазе 1
    const First$ = makeToken<string>('Ambiguous');
    const Second$ = makeToken<string>('Ambiguous');

    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
      providers: [valueProvider(First$, 'a'), valueProvider(Second$, 'b')],
      logging: { logger: probe.logger },
    }).build();

    await app.run();
    await app.close();

    const messages = probe.entries.map(({ message }) => message);

    // Предупреждение сборки — фаза 1, строка состава — фаза RUN, и оба в
    // одном логгере
    expect(
      messages.some((text) => text.includes('ambiguous DI token ids')),
    ).toBe(true);
    expect(messages.some((text) => text.startsWith('features:'))).toBe(true);
  });

  it('без опции корнем служит штатный логгер ядра', async () => {
    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
    }).build();

    await expect(app.run()).resolves.toBeUndefined();
    await app.close();
  });

  it('токены семейства строятся от логгера опции', async () => {
    const probe = loggerProbe();
    const Service$ = makeToken<unknown>('Service');

    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
      providers: [
        factoryProvider(
          Service$,
          (logger: Logger) => {
            logger.info('from users');

            return {};
          },
          [Logger$('users')] as const,
        ),
      ],
      logging: { logger: probe.logger },
    }).build();

    await app.run();
    await app.close();

    expect(probe.entries).toContainEqual({
      level: 'info',
      message: 'from users',
      fields: { scope: 'users' },
    });
  });

  it('провайдер под RootLogger$ отвергается, называя опцию корня', async () => {
    const probe = loggerProbe();

    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
      providers: [valueProvider(RootLogger$, probe.logger)],
    }).build();

    await expect(app.run()).rejects.toThrow(
      /root logger is set by the 'logging' option of makeApp/,
    );
  });
});

describe('поля корреляции корня', () => {
  /** Куда узел графа кладёт свой член семейства логгеров */
  interface Sink {
    logger?: Logger;
  }

  /**
   * Узел, который запоминает `Logger$('users')`.
   *
   * Хендлер объявлен функцией и зависимостей не имеет, а запись обязана
   * уйти из глубины графа: там же, где её сделал бы сервис.
   */
  const capturing = (sink: Sink) =>
    factoryProvider(
      makeToken<unknown>('Capture'),
      (logger: Logger) => {
        sink.logger = logger;

        return {};
      },
      [Logger$('users')] as const,
    );

  /** Endpoint, который пишет запись запомненным логгером */
  const writing = (sink: Sink, layer: PreStepFn<any, any>) =>
    testEndpoint({
      method: 'GET',
      path: '/write',
      output: z.object({ ok: z.boolean() }),
      pipeline: makePipeline().pre(layer),
      handler: async () => {
        sink.logger?.info('select');

        return new Ok({ ok: true });
      },
    });

  it('внешний логгер получает requestId', async () => {
    const probe = loggerProbe();
    const sink: Sink = {};
    const endpoint = writing(sink, withRequestId());

    const fields = await recordOf(
      makeApp({
        endpoints: [endpoint],
        transports: [asTransport(new MockTransport())],
        providers: [capturing(sink)],
        logging: { logger: probe.logger },
      }),
      endpoint,
      probe,
    );

    expect(fields).toMatchObject({ scope: 'users' });
    expect(typeof fields?.requestId).toBe('string');
  });

  it('поле плагина попадает в записи, хотя корень его не объявлял', async () => {
    const probe = loggerProbe();
    const sink: Sink = {};
    const Tenant = contextVar<string>()('tenant');
    const endpoint = writing(
      sink,
      Tenant.provide(() => 'acme'),
    );

    const fields = await recordOf(
      makeApp({
        endpoints: [endpoint],
        transports: [asTransport(new MockTransport())],
        providers: [capturing(sink)],
        plugins: [makePlugin({ name: '@acme/tenancy', logFields: [Tenant] })],
        logging: { logger: probe.logger },
      }),
      endpoint,
      probe,
    );

    expect(fields).toEqual({ scope: 'users', tenant: 'acme' });
  });

  it('поля выключенной ветки в записях не появляются', async () => {
    const probe = loggerProbe();
    const sink: Sink = {};
    const Tenant = contextVar<string>()('tenant');
    const endpoint = writing(
      sink,
      Tenant.provide(() => 'acme'),
    );
    const tenancy = makeSwitch('tenancy', { default: 'off' });

    const fields = await recordOf(
      makeApp({
        endpoints: [endpoint],
        transports: [asTransport(new MockTransport())],
        providers: [capturing(sink)],
        switches: [tenancy] as const,
        plugins: [
          tenancy.when(
            makePlugin({ name: '@acme/tenancy', logFields: [Tenant] }),
          ),
        ],
        logging: { logger: probe.logger },
      }),
      endpoint,
      probe,
    );

    expect(fields).toEqual({ scope: 'users' });
  });

  it('пустой список fields отключает корреляцию', async () => {
    const probe = loggerProbe();
    const sink: Sink = {};
    const endpoint = writing(sink, withRequestId());

    const fields = await recordOf(
      makeApp({
        endpoints: [endpoint],
        transports: [asTransport(new MockTransport())],
        providers: [capturing(sink)],
        logging: { logger: probe.logger, fields: [] },
      }),
      endpoint,
      probe,
    );

    expect(fields).toEqual({ scope: 'users' });
  });

  it('дубль имени поля у корня и плагина роняет сборку', async () => {
    const Caller = contextVar<string>()('caller');
    const Session = contextVar<string>()('session');

    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
      plugins: [
        makePlugin({
          name: '@acme/session',
          logFields: [logField(Session, 'user')],
        }),
      ],
      logging: { fields: [logField(Caller, 'user')] },
    }).build();

    await expect(app.run()).rejects.toThrow(
      /Two log fields are named 'user'.*logging\.fields.*plugin '@acme\/session'/s,
    );
  });

  it('дубль имени поля у двух плагинов роняет сборку', async () => {
    const First = contextVar<string>()('first');
    const Second = contextVar<string>()('second');

    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
      plugins: [
        makePlugin({ name: '@acme/one', logFields: [logField(First, 'tag')] }),
        makePlugin({ name: '@acme/two', logFields: [logField(Second, 'tag')] }),
      ],
    }).build();

    await expect(app.run()).rejects.toThrow(
      /Two log fields are named 'tag'.*plugin '@acme\/one'.*plugin '@acme\/two'/s,
    );
  });
});
