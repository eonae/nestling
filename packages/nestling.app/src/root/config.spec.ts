/**
 * Конфиг в корне: прогрессивность (только env), приоритет источников,
 * граница фазы 0 и fail-fast на старте — до того, как транспорт начнёт
 * слушать.
 */

import type { Config, ConfigSource } from '../config/index.js';
import {
  ConfigValidationError,
  makeConfig,
  objectSource,
} from '../config/index.js';
import { transportValue } from '../transport/index.js';

import { TestTransport$, VALUE_ONLY } from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { makeFeature } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import { Component, Resource } from '@nestling/container';
import { z } from 'zod';

const RootConfig = makeConfig('rootapp', {
  greeting: z.string().default('hi'),
  retries: z.coerce.number(),
});

/** Куда приземляются спроецированные значения: контейнер App не публичен. */
const projected: Config<typeof RootConfig>[] = [];

@Component([RootConfig])
class Greeter {
  constructor(cfg: Config<typeof RootConfig>) {
    projected.push(cfg);
  }
}

const GreeterModule = makeFeature({
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

/** Отметки фаз в порядке их наступления */
const phases: string[] = [];

/**
 * Ресурс-зонд: захват отмечает фазу INIT, освобождение — фазу SHUTDOWN.
 * Захват читает секцию конфига, поэтому виден и порядок относительно
 * источников.
 */
@Resource([RootConfig])
class PhaseProbe {
  static async acquire(
    cfg: Config<typeof RootConfig>,
    _signal: AbortSignal,
  ): Promise<PhaseProbe> {
    projected.push(cfg);
    phases.push('construct');

    return new PhaseProbe();
  }

  release(): void {
    phases.push('destroy');
  }
}

const ProbeFeature = makeFeature({
  name: 'module:probe',
  providers: [PhaseProbe],
});

/** Источник, отмечающий свои вызовы: им и проверяется граница фазы 0. */
const probeSource = (
  values: Record<string, string>,
  name = 'probe',
): { source: ConfigSource; reads: string[] } => {
  const reads: string[] = [];

  return {
    reads,
    source: {
      name,
      init: async () => {
        await Promise.resolve();
        phases.push('init');
      },
      get: (key) => {
        reads.push(key);

        return values[key];
      },
      close: async () => {
        await Promise.resolve();
        phases.push('close');
      },
    },
  };
};

beforeEach(() => {
  projected.length = 0;
  phases.length = 0;
});

describe('привязка конфига в assemble', () => {
  it('прогрессивность: без поля config секции читаются из process.env', async () => {
    await withEnv({ ROOTAPP_RETRIES: '3' }, async () => {
      const transport = new MockTransport();
      const app = makeApp({
        features: [GreeterModule],
        transports: [
          transportValue(TestTransport$('default'), transport, {
            capabilities: VALUE_ONLY,
          }),
        ],
      }).assemble();

      await app.run();

      expect(transport.serving).toBe(true);
      expect(projected).toEqual([{ greeting: 'hi', retries: 3 }]);

      await app.close();
    });
  });

  it('порядок привязок задаёт приоритет, env остаётся источником по умолчанию', async () => {
    await withEnv(
      { ROOTAPP_RETRIES: '1', ROOTAPP_GREETING: 'from-env' },
      async () => {
        const app = makeApp({
          features: [GreeterModule],
          transports: [
            transportValue(TestTransport$('default'), new MockTransport(), {
              capabilities: VALUE_ONLY,
            }),
          ],
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
        }).assemble();

        await app.run();

        // retries — из первой привязки, greeting — из второй (первая его не
        // знает), env остаётся источником по умолчанию и не используется
        expect(projected).toEqual([{ greeting: 'low', retries: 5 }]);

        await app.close();
      },
    );
  });

  it('невалидный конфиг роняет старт до приёма запросов', async () => {
    const transport = new MockTransport();
    const app = makeApp({
      features: [GreeterModule],
      transports: [
        transportValue(TestTransport$('default'), transport, {
          capabilities: VALUE_ONLY,
        }),
      ],
      config: [[objectSource({ ROOTAPP_RETRIES: 'abc' }, 'test'), '*']],
    }).assemble();

    // Секция — провайдер значения: сборка вычисляет её сразу, и ошибка
    // валидации доходит наружу как есть
    const failure = await app.run().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConfigValidationError);
    expect(transport.serving).toBe(false);
  });

  it('обязательный ключ, которого нет нигде, роняет старт', async () => {
    const transport = new MockTransport();
    const app = makeApp({
      features: [GreeterModule],
      transports: [
        transportValue(TestTransport$('default'), transport, {
          capabilities: VALUE_ONLY,
        }),
      ],
    }).assemble();

    await expect(app.run()).rejects.toThrow(/ROOTAPP_RETRIES/);
    expect(transport.serving).toBe(false);
  });
});

describe('фаза 0 BOOTSTRAP', () => {
  it('поднимает источники до графа, а сборка их не опрашивает', async () => {
    const { source, reads } = probeSource({ ROOTAPP_RETRIES: '3' });

    const app = makeApp({
      features: [ProbeFeature],
      transports: [
        transportValue(TestTransport$('default'), new MockTransport(), {
          capabilities: VALUE_ONLY,
        }),
      ],
      config: [[source, '*']],
    }).assemble();

    await app.run();

    // `init()` источника завершился до захвата первого ресурса
    expect(phases).toEqual(['init', 'construct']);

    // Ключ прочитан ровно один раз — снимком фазы 0; проекция секции
    // на фазе 1 идёт уже в снимок
    expect(reads.filter((key) => key === 'ROOTAPP_RETRIES')).toHaveLength(1);
    expect(projected).toEqual([{ greeting: 'hi', retries: 3 }]);

    await app.close();
  });

  it('закрывает источники на shutdown, после освобождения ресурса графа', async () => {
    const { source } = probeSource({ ROOTAPP_RETRIES: '3' });

    const app = makeApp({
      features: [ProbeFeature],
      transports: [
        transportValue(TestTransport$('default'), new MockTransport(), {
          capabilities: VALUE_ONLY,
        }),
      ],
      config: [[source, '*']],
    }).assemble();

    await app.run();
    await app.close();

    expect(phases).toEqual(['init', 'construct', 'destroy', 'close']);
  });

  it('отказ источника роняет старт, называя его, и графа не строит', async () => {
    const failing: ConfigSource = {
      name: 'vault',
      init: () => {
        throw new Error('connection refused');
      },
      // eslint-disable-next-line unicorn/no-useless-undefined
      get: () => undefined,
    };

    const transport = new MockTransport();
    const app = makeApp({
      features: [ProbeFeature],
      transports: [
        transportValue(TestTransport$('default'), transport, {
          capabilities: VALUE_ONLY,
        }),
      ],
      config: [[failing, '*']],
    }).assemble();

    await expect(app.run()).rejects.toThrow(/Config source 'vault'/);

    expect(phases).toEqual([]);
    expect(transport.serving).toBe(false);
  });
});

describe('check() и источники', () => {
  it('с config: vars({ … }) привязки декларации не поднимаются', async () => {
    const { source } = probeSource({ ROOTAPP_RETRIES: '3' }, 'declared');

    const app = makeApp({
      features: [ProbeFeature],
      transports: [
        transportValue(TestTransport$('default'), new MockTransport(), {
          capabilities: VALUE_ONLY,
        }),
      ],
      config: [[source, '*']],
    });

    await app.check(undefined, {
      config: objectSource({ ROOTAPP_RETRIES: '7' }, 'vars'),
    });

    // `check()` не создаёт экземпляров: ресурс не захватывается, а
    // объявленный источник не поднимается вовсе — проверка обошлась
    // переданным и ввода-вывода не сделала
    expect(phases).toEqual([]);
  });

  it('закрывает источники сразу после отчёта, хотя графа не разрушает', async () => {
    const { source } = probeSource({ ROOTAPP_RETRIES: '3' });

    const app = makeApp({
      features: [ProbeFeature],
      transports: [
        transportValue(TestTransport$('default'), new MockTransport(), {
          capabilities: VALUE_ONLY,
        }),
      ],
      config: [[source, '*']],
    });

    await app.check();

    // Ресурс не захватывался — `check()` не создаёт экземпляров, — а
    // источники уже закрыты
    expect(phases).toEqual(['init', 'close']);
  });
});
