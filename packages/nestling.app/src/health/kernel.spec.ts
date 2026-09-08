/* eslint-disable @typescript-eslint/no-empty-function */

/**
 * Пробы ядра: итог по фазе и критичности, таймаут, кэш, один прогон на
 * всех, отчёт без деталей отказа и вклад ресурса.
 */

import { bootstrapConfig, configKernel } from '../config/index.js';
import { spyLogger } from '../logger/__fixtures__/spy.js';
import { loggerKernel } from '../logger/index.js';
import { RootLogger$ } from '../logger/tokens.js';
import type { AppPhase } from '../root/phase.js';

import type { Health, HealthCheck, HealthStatus } from './interface.js';
import { registerHealth } from './kernel.js';
import { Health$, HealthCheck$ } from './tokens.js';

import type { BuiltContainer, ModuleProvider } from '@nestling/container';
import {
  ContainerBuilder,
  factoryProvider,
  makeToken,
  resourceProvider,
  valueProvider,
} from '@nestling/container';

/** Вклад-заглушка: считает вызовы и отдаёт заданный исход */
class StubCheck implements HealthCheck {
  calls = 0;

  constructor(
    readonly critical: boolean,
    private readonly outcome: HealthStatus | Error,
    private readonly delayMs = 0,
  ) {}

  async check(signal: AbortSignal): Promise<HealthStatus> {
    this.calls += 1;

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    signal.throwIfAborted();

    if (this.outcome instanceof Error) {
      throw this.outcome;
    }

    return this.outcome;
  }
}

/** Записи логгера ядра — общие на весь граф теста */
const spy = spyLogger();

/**
 * Минимальный граф с пробами: конфиг, логгер и то, что передали вкладами.
 *
 * Фаза приходит функцией, как и в бою: тест двигает её из переменной.
 */
const wire = async (
  phase: () => AppPhase,
  providers: readonly ModuleProvider[] = [],
  env: Record<string, string> = {},
): Promise<BuiltContainer> => {
  // Значения выставляются до фазы 0: снимок читалки снимается в
  // `bootstrapConfig`, и позже `process.env` на секцию уже не влияет
  Object.assign(process.env, env);

  const reader = await bootstrapConfig();
  const builder = new ContainerBuilder();

  builder.register(configKernel(reader), loggerKernel());
  builder.register(valueProvider(RootLogger$, spy.logger));

  if (providers.length > 0) {
    builder.register(...providers);
  }

  registerHealth(builder, phase);

  const container = builder.build();
  await container.init();

  return container;
};

/** Снимает переменные секции: умолчания обязаны действовать без них */
const clearEnv = (): void => {
  Reflect.deleteProperty(process.env, 'NESTLING_HEALTH_TIMEOUT');
  Reflect.deleteProperty(process.env, 'NESTLING_HEALTH_CACHE');
};

beforeEach(() => {
  clearEnv();
});

afterEach(() => {
  clearEnv();
});

describe('узел проб', () => {
  it('есть у приложения без единого вклада, и список проверок пуст', async () => {
    const container = await wire(() => 'RUN');
    const health = container.getOrThrow<Health>(Health$);

    await expect(health.readiness()).resolves.toEqual({
      status: 'ready',
      phase: 'RUN',
      checks: [],
    });
  });

  it('liveness отвечает ok и проверок не запускает', async () => {
    const check = new StubCheck(true, new Error('db is down'));
    const container = await wire(
      () => 'RUN',
      [factoryProvider(HealthCheck$('db'), () => check, [])],
    );

    expect(container.getOrThrow<Health>(Health$).liveness()).toEqual({
      status: 'ok',
    });
    expect(check.calls).toBe(0);
  });

  it('собирает исходы вкладов из разных модулей', async () => {
    const container = await wire(
      () => 'RUN',
      [
        factoryProvider(
          HealthCheck$('db'),
          () => new StubCheck(true, 'ok'),
          [],
        ),
        factoryProvider(
          HealthCheck$('cache'),
          () => new StubCheck(false, 'degraded'),
          [],
        ),
      ],
    );

    const report = await container.getOrThrow<Health>(Health$).readiness();

    expect(report.status).toBe('ready');
    expect(report.checks.map(({ name, status }) => [name, status])).toEqual([
      ['db', 'ok'],
      ['cache', 'degraded'],
    ]);
  });

  it('критичная проверка со статусом down делает итог not_ready', async () => {
    const container = await wire(
      () => 'RUN',
      [
        factoryProvider(
          HealthCheck$('db'),
          () => new StubCheck(true, 'down'),
          [],
        ),
      ],
    );

    const report = await container.getOrThrow<Health>(Health$).readiness();

    expect(report.status).toBe('not_ready');
    expect(report.checks[0]).toMatchObject({ name: 'db', status: 'down' });
  });

  it('некритичная проверка со статусом down итога не меняет', async () => {
    const container = await wire(
      () => 'RUN',
      [
        factoryProvider(
          HealthCheck$('cache'),
          () => new StubCheck(false, 'down'),
          [],
        ),
      ],
    );

    const report = await container.getOrThrow<Health>(Health$).readiness();

    expect(report.status).toBe('ready');
    expect(report.checks[0]).toMatchObject({ name: 'cache', status: 'down' });
  });

  it('до RUN и на SHUTDOWN итог not_ready без единого вызова check', async () => {
    let phase: AppPhase = 'START';
    const check = new StubCheck(true, 'ok');

    const container = await wire(
      () => phase,
      [factoryProvider(HealthCheck$('db'), () => check, [])],
    );
    const health = container.getOrThrow<Health>(Health$);

    await expect(health.readiness()).resolves.toEqual({
      status: 'not_ready',
      phase: 'START',
      checks: [],
    });

    phase = 'SHUTDOWN';

    await expect(health.readiness()).resolves.toEqual({
      status: 'not_ready',
      phase: 'SHUTDOWN',
      checks: [],
    });

    expect(check.calls).toBe(0);
  });
});

describe('таймаут, кэш и один прогон на всех', () => {
  it('проверка, не уложившаяся в таймаут, — down с reason timeout', async () => {
    const check = new StubCheck(true, 'ok', 500);
    const container = await wire(
      () => 'RUN',
      [factoryProvider(HealthCheck$('db'), () => check, [])],
      { NESTLING_HEALTH_TIMEOUT: '20' },
    );

    const started = Date.now();
    const report = await container.getOrThrow<Health>(Health$).readiness();

    expect(report.checks[0]).toMatchObject({
      name: 'db',
      status: 'down',
      reason: 'timeout',
    });
    expect(report.status).toBe('not_ready');
    // Отчёт вернулся, не дожидаясь самой проверки
    expect(Date.now() - started).toBeLessThan(400);
  });

  it('три пробы за срок кэша дают один прогон и одни исходы', async () => {
    const check = new StubCheck(true, 'ok');
    const container = await wire(
      () => 'RUN',
      [factoryProvider(HealthCheck$('db'), () => check, [])],
      { NESTLING_HEALTH_CACHE: '1000' },
    );
    const health = container.getOrThrow<Health>(Health$);

    const first = await health.readiness();
    const second = await health.readiness();
    const third = await health.readiness();

    expect(check.calls).toBe(1);
    expect(second.checks).toBe(first.checks);
    expect(third.checks).toBe(first.checks);
  });

  it('кэш 0 отключает кэширование', async () => {
    const check = new StubCheck(true, 'ok');
    const container = await wire(
      () => 'RUN',
      [factoryProvider(HealthCheck$('db'), () => check, [])],
      { NESTLING_HEALTH_CACHE: '0' },
    );
    const health = container.getOrThrow<Health>(Health$);

    await health.readiness();
    await health.readiness();

    expect(check.calls).toBe(2);
  });

  it('параллельные пробы делят один прогон', async () => {
    const check = new StubCheck(true, 'ok', 30);
    const container = await wire(
      () => 'RUN',
      [factoryProvider(HealthCheck$('db'), () => check, [])],
      { NESTLING_HEALTH_CACHE: '0' },
    );
    const health = container.getOrThrow<Health>(Health$);

    const [first, second] = await Promise.all([
      health.readiness(),
      health.readiness(),
    ]);

    expect(check.calls).toBe(1);
    expect(second.checks).toBe(first.checks);
  });

  it('умолчания секции действуют без единой привязки', async () => {
    const check = new StubCheck(true, 'ok');
    const container = await wire(
      () => 'RUN',
      [factoryProvider(HealthCheck$('db'), () => check, [])],
    );
    const health = container.getOrThrow<Health>(Health$);

    // Умолчание кэша — 1000 мс: второй вызов берёт исходы прогона
    await health.readiness();
    await health.readiness();

    expect(check.calls).toBe(1);
  });

  it('значение секции вне неотрицательных целых — ошибка сборки с именем ключа', async () => {
    await expect(
      wire(() => 'RUN', [], { NESTLING_HEALTH_TIMEOUT: 'soon' }),
    ).rejects.toThrow(/NESTLING_HEALTH_TIMEOUT/);
  });
});

describe('отчёт не раскрывает деталей отказа', () => {
  it('ошибка проверки уходит в лог, а не в отчёт', async () => {
    const original = new Error('password authentication failed');
    const container = await wire(
      () => 'RUN',
      [
        factoryProvider(
          HealthCheck$('db'),
          () => new StubCheck(true, original),
          [],
        ),
      ],
    );

    const before = spy.entries.length;
    const report = await container.getOrThrow<Health>(Health$).readiness();

    expect(report.checks[0]).toEqual({
      name: 'db',
      critical: true,
      status: 'down',
      durationMs: expect.any(Number),
      reason: 'error',
    });
    expect(JSON.stringify(report)).not.toContain('password');

    const record = spy.entries.slice(before).at(-1);

    expect(record?.level).toBe('error');
    expect(record?.fields).toMatchObject({
      check: 'db',
      reason: 'error',
      err: original,
      scope: 'nestling:health',
    });
  });

  it('провал некритичной проверки пишется уровнем warn', async () => {
    const container = await wire(
      () => 'RUN',
      [
        factoryProvider(
          HealthCheck$('cache'),
          () => new StubCheck(false, new Error('connection refused')),
          [],
        ),
      ],
    );

    const before = spy.entries.length;
    await container.getOrThrow<Health>(Health$).readiness();

    expect(spy.entries.slice(before).at(-1)?.level).toBe('warn');
  });
});

describe('вклад ресурса', () => {
  it('ресурс с health становится критичной проверкой под именем узла', async () => {
    const Cache$ = makeToken<{ release(): void }>('Cache');
    const checked: string[] = [];

    const container = await wire(
      () => 'RUN',
      [
        resourceProvider(Cache$, {
          deps: [] as const,
          acquire: () => ({ release: () => {} }),
          release: () => {},
          health: async (): Promise<HealthStatus> => {
            checked.push('cache');
            return 'ok';
          },
        }),
      ],
    );

    const report = await container.getOrThrow<Health>(Health$).readiness();

    expect(report.checks).toEqual([
      {
        name: 'Cache',
        critical: true,
        status: 'ok',
        durationMs: expect.any(Number),
      },
    ]);
    expect(checked).toEqual(['cache']);
  });

  it('ресурс без health вкладом не становится', async () => {
    const Pool$ = makeToken<{ release(): void }>('Pool');

    const container = await wire(
      () => 'RUN',
      [
        resourceProvider(Pool$, {
          deps: [] as const,
          acquire: () => ({ release: () => {} }),
          release: () => {},
        }),
      ],
    );

    const report = await container.getOrThrow<Health>(Health$).readiness();

    expect(report.checks).toEqual([]);
  });
});
