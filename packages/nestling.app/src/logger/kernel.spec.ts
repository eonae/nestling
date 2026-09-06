/**
 * Kernel-модуль логгера в графе: умолчание под корнем, семейство областей,
 * `.auto`, замена корня и секция `nestlingLog`.
 */

import { configKernel, ConfigValidationError } from '../config/index.js';
import { contextKernel } from '../pipeline/core/context/index.js';

import { spyLogger } from './__fixtures__/spy.js';
import { ConsoleLogger } from './console.js';
import type { Logger } from './interface.js';
import { loggerKernel } from './kernel.js';
import { Logger$, RootLogger$ } from './tokens.js';

import { jest } from '@jest/globals';
import type { ContainerBuilderOptions, Module } from '@nestling/container';
import {
  ContainerBuilder,
  factoryProvider,
  Injectable,
  makeModule,
  makeToken,
} from '@nestling/container';

const Service$ = makeToken<Logger>('Service');

/** Минимальный граф ядра: конфиг, контекст запроса и логгер */
const kernelBuilder = (options: ContainerBuilderOptions = {}) =>
  new ContainerBuilder(options).register(
    configKernel(),
    contextKernel(),
    loggerKernel(),
  );

/** Выставляет переменные окружения на время теста */
function withEnv(values: Record<string, string>): () => void {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]] as const),
  );

  Object.assign(process.env, values);

  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  };
}

describe('loggerKernel: корень и семейство', () => {
  it('без соперника под RootLogger$ стоит ConsoleLogger', async () => {
    const container = await kernelBuilder().build();

    expect(container.get(RootLogger$)).toBeInstanceOf(ConsoleLogger);
    expect(container.get(Logger$('nestling'))).toBeInstanceOf(ConsoleLogger);

    const { nodes } = await container.toJSON();

    expect(nodes.find((n) => n.id === 'RootLogger')?.metadata.module).toBe(
      'kernel:logger',
    );
    expect(nodes.find((n) => n.id === 'Logger:nestling')?.metadata.module).toBe(
      'kernel:logger',
    );
  });

  it('член семейства — дочерний логгер корня с привязкой scope', async () => {
    const spy = spyLogger();

    const container = await kernelBuilder({
      overrides: [[RootLogger$, spy.logger]],
    })
      .register(
        factoryProvider(Service$, (logger) => logger, [Logger$('users')]),
      )
      .build();

    container.getOrThrow(Service$).info('byId', { id: '1' });

    expect(spy.entries).toEqual([
      { level: 'info', message: 'byId', fields: { scope: 'users', id: '1' } },
    ]);
  });

  it('.auto даёт член по имени класса-потребителя', async () => {
    const spy = spyLogger();

    @Injectable([Logger$.auto])
    class UsersRepository {
      constructor(readonly logger: Logger) {}
    }

    const container = await kernelBuilder({
      overrides: [[RootLogger$, spy.logger]],
    })
      .register(UsersRepository)
      .build();

    container.getOrThrow(UsersRepository).logger.debug('select');

    expect(spy.entries[0]?.fields).toEqual({ scope: 'UsersRepository' });
    expect(container.get(Logger$('UsersRepository'))).toBe(
      container.getOrThrow(UsersRepository).logger,
    );
  });

  it.each([
    ['плагин раньше ядра', true],
    ['плагин после ядра', false],
  ])(
    'провайдер плагина под RootLogger$ заменяет умолчание без ошибки дубля (%s)',
    async (_name, pluginFirst) => {
      const spy = spyLogger();
      const plugin: Module = makeModule({
        name: 'plugin:logging',
        providers: [factoryProvider(RootLogger$, () => spy.logger, [])],
      });

      const builder = pluginFirst
        ? new ContainerBuilder().register(
            plugin,
            configKernel(),
            contextKernel(),
            loggerKernel(),
          )
        : kernelBuilder().register(plugin);

      const container = await builder
        .register(
          factoryProvider(Service$, (logger) => logger, [Logger$('users')]),
        )
        .build();

      expect(container.get(RootLogger$)).toBe(spy.logger);

      container.getOrThrow(Service$).warn('x');

      expect(spy.entries).toEqual([
        { level: 'warn', message: 'x', fields: { scope: 'users' } },
      ]);
    },
  );
});

describe('loggerKernel: секция nestlingLog', () => {
  it('уровень и формат читаются из NESTLING_LOG_LEVEL и NESTLING_LOG_FORMAT', async () => {
    const restore = withEnv({
      NESTLING_LOG_LEVEL: 'warn',
      NESTLING_LOG_FORMAT: 'json',
    });

    try {
      const container = await kernelBuilder().build();
      const logger = container.getOrThrow(Logger$('nestling'));

      const lines: string[] = [];
      const write = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: unknown) => {
          lines.push(String(chunk));

          return true;
        });

      try {
        logger.info('hidden');
        logger.warn('shown', { n: 1 });
      } finally {
        write.mockRestore();
      }

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({
        level: 'warn',
        scope: 'nestling',
        msg: 'shown',
        n: 1,
      });
    } finally {
      restore();
    }
  });

  it('невалидный NESTLING_LOG_LEVEL роняет сборку с перечнем значений', async () => {
    const restore = withEnv({ NESTLING_LOG_LEVEL: 'loud' });

    try {
      const build = kernelBuilder().build();

      await expect(build).rejects.toBeInstanceOf(ConfigValidationError);
      await expect(build).rejects.toThrow(
        /'debug', 'info', 'warn', 'error'.*got "loud"/s,
      );
    } finally {
      restore();
    }
  });

  it('подмена корня выбрасывает секцию из графа: значение не проверяется', async () => {
    const restore = withEnv({ NESTLING_LOG_LEVEL: 'loud' });

    try {
      const container = await kernelBuilder({
        overrides: [[RootLogger$, spyLogger().logger]],
      }).build();

      expect(container.pruned).toContain('ConfigSection:nestlingLog');
    } finally {
      restore();
    }
  });
});
