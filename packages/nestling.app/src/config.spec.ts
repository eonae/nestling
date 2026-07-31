/**
 * Конфиг в корне: прогрессивность (только env), приоритет источников и
 * fail-fast на старте — до того, как транспорт начнёт слушать.
 */

import { App } from './app';
import { MockTransport } from './helpers';

import { describe, expect, it } from '@jest/globals';
import type { Config } from '@nestling/config';
import {
  ConfigValidationError,
  makeConfig,
  objectSource,
} from '@nestling/config';
import { Injectable, makeModule } from '@nestling/container';
import { z } from 'zod';

const RootConfig = makeConfig('rootapp', {
  greeting: z.string().default('hi'),
  retries: z.coerce.number(),
});

/** Куда приземляются спроецированные значения: контейнер App не публичен. */
const projected: Config<typeof RootConfig>[] = [];

@Injectable([RootConfig])
class Greeter {
  constructor(cfg: Config<typeof RootConfig>) {
    projected.push(cfg);
  }
}

const GreeterModule = makeModule({
  name: 'module:greeter',
  providers: [Greeter],
});

/** Выполняет тело с временно выставленными переменными окружения. */
const withEnv = async (
  values: Record<string, string>,
  body: () => Promise<void>,
): Promise<void> => {
  const saved = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);

  try {
    await body();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  }
};

beforeEach(() => {
  projected.length = 0;
});

describe('AppConfig.config', () => {
  it('прогрессивность: без поля config секции читаются из process.env', async () => {
    await withEnv({ ROOTAPP_RETRIES: '3' }, async () => {
      const transport = new MockTransport();
      const app = new App({
        transports: { http: transport as never },
        modules: [GreeterModule],
      });

      await app.run();

      expect(transport.listening).toBe(true);
      expect(projected).toEqual([{ greeting: 'hi', retries: 3 }]);

      await app.close();
    });
  });

  it('порядок привязок задаёт приоритет, env остаётся полом', async () => {
    await withEnv(
      { ROOTAPP_RETRIES: '1', ROOTAPP_GREETING: 'from-env' },
      async () => {
        const app = new App({
          transports: { http: new MockTransport() as never },
          modules: [GreeterModule],
          config: [
            [objectSource({ ROOTAPP_RETRIES: '5' }, 'high'), '*'],
            [
              objectSource(
                { ROOTAPP_RETRIES: '9', ROOTAPP_GREETING: 'low' },
                'low',
              ),
              '*',
            ],
          ],
        });

        await app.run();

        // retries — из первой привязки, greeting — из второй (первая его не
        // знает), env остаётся полом и в дело не идёт
        expect(projected).toEqual([{ greeting: 'low', retries: 5 }]);

        await app.close();
      },
    );
  });

  it('невалидный конфиг роняет старт до listen()', async () => {
    const transport = new MockTransport();
    const app = new App({
      transports: { http: transport as never },
      modules: [GreeterModule],
      config: [[objectSource({ ROOTAPP_RETRIES: 'abc' }, 'test'), '*']],
    });

    await expect(app.run()).rejects.toThrow(ConfigValidationError);
    expect(transport.listening).toBe(false);
  });

  it('обязательный ключ, которого нет нигде, роняет старт', async () => {
    const transport = new MockTransport();
    const app = new App({
      transports: { http: transport as never },
      modules: [GreeterModule],
    });

    await expect(app.run()).rejects.toThrow(/ROOTAPP_RETRIES/);
    expect(transport.listening).toBe(false);
  });
});
