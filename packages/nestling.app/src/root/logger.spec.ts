/**
 * Корневой логгер приложения: опция корня, единый логгер на все фазы и
 * запрет второго объявления.
 */

import type { Logger } from '../logger/index.js';
import { Logger$, RootLogger$ } from '../logger/index.js';
import { Ok } from '../pipeline/index.js';
import { transportValue } from '../transport/index.js';

import { loggerProbe } from './__fixtures__/logger.js';
import {
  testEndpoint,
  TestTransport$,
  VALUE_ONLY,
} from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import { factoryProvider, makeToken, valueProvider } from '@nestling/container';
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
      logger: probe.logger,
    }).assemble();

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

  it('без опции корнем служит ConsoleLogger ядра', async () => {
    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
    }).assemble();

    await expect(app.run()).resolves.toBeUndefined();
    await app.close();
  });

  it('члены семейства строятся от логгера опции', async () => {
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
      logger: probe.logger,
    }).assemble();

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
    }).assemble();

    await expect(app.run()).rejects.toThrow(
      /root logger is set by the 'logger' option of makeApp/,
    );
  });
});
