/**
 * Логгер ядра: корень вне графа, семейство областей, `.auto` и секция
 * `nestlingLog`.
 */

import type { ConfigReader } from '../config/index.js';
import {
  bootstrapConfig,
  configKernel,
  ConfigValidationError,
} from '../config/index.js';
import { contextKernel } from '../pipeline/core/context/index.js';

import { spyLogger } from './__fixtures__/spy.js';
import { ConsoleLogger } from './console.js';
import type { Logger } from './interface.js';
import { loggerKernel, makeKernelLogger } from './kernel.js';
import { Logger$, RootLogger$ } from './tokens.js';

import { jest } from '@jest/globals';
import type { ContainerBuilderOptions } from '@nestlingjs/container';
import {
  Component,
  ContainerBuilder,
  factoryProvider,
  makeToken,
  valueProvider,
} from '@nestlingjs/container';

const Service$ = makeToken<Logger>('Service');

/**
 * Минимальный граф ядра: конфиг, контекст запроса и логгер.
 *
 * Асинхронен из-за фазы 0: корень логгера создаётся от снимка конфига до
 * сборки, поэтому `withEnv` в тесте обязан отработать раньше вызова.
 */
const kernelBuilder = async (
  options: ContainerBuilderOptions = {},
  root?: Logger,
) => {
  const reader = await bootstrapConfig();

  return new ContainerBuilder(options).register(
    configKernel(reader),
    contextKernel(),
    loggerKernel(),
    valueProvider(RootLogger$, root ?? makeKernelLogger(reader)),
  );
};

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

describe('корневой логгер вне графа', () => {
  it('умолчание ядра — ConsoleLogger от снимка секции', async () => {
    const reader: ConfigReader = await bootstrapConfig();

    expect(makeKernelLogger(reader)).toBeInstanceOf(ConsoleLogger);
  });

  it('корень зарегистрирован провайдером значения и атрибутирован сборке', async () => {
    const builder = await kernelBuilder();
    const container = builder.build();

    await container.init();

    expect(container.get(RootLogger$)).toBeInstanceOf(ConsoleLogger);
    expect(container.get(Logger$('nestling'))).toBeInstanceOf(ConsoleLogger);

    const { nodes } = await container.toJSON();

    expect(nodes.find((n) => n.id === 'Logger:nestling')?.metadata.module).toBe(
      'kernel:logger',
    );
  });

  it('второй провайдер под RootLogger$ — ошибка дубля', async () => {
    const builder = await kernelBuilder();

    expect(() =>
      builder.register(
        factoryProvider(RootLogger$, () => spyLogger().logger, []),
      ),
    ).toThrow(/Provider for DI token 'RootLogger' is already registered/);
  });

  it('логгер приложения заменяет корень целиком', async () => {
    const spy = spyLogger();

    const builder = await kernelBuilder({}, spy.logger);
    const container = builder
      .register(
        factoryProvider(Service$, (logger) => logger, [Logger$('users')]),
      )
      .build();

    await container.init();

    container.getOrThrow(Service$).warn('x');

    expect(spy.entries).toEqual([
      { level: 'warn', message: 'x', fields: { scope: 'users' } },
    ]);
  });
});

describe('loggerKernel: семейство областей', () => {
  it('член семейства — дочерний логгер корня с привязкой scope', async () => {
    const spy = spyLogger();

    const builder = await kernelBuilder({
      overrides: [[RootLogger$, spy.logger]],
    });
    const container = builder
      .register(
        factoryProvider(Service$, (logger) => logger, [Logger$('users')]),
      )
      .build();

    await container.init();

    container.getOrThrow(Service$).info('byId', { id: '1' });

    expect(spy.entries).toEqual([
      { level: 'info', message: 'byId', fields: { scope: 'users', id: '1' } },
    ]);
  });

  it('.auto даёт член по имени класса-потребителя', async () => {
    const spy = spyLogger();

    @Component([Logger$.auto])
    class UsersRepository {
      constructor(readonly logger: Logger) {}
    }

    const builder = await kernelBuilder({
      overrides: [[RootLogger$, spy.logger]],
    });
    const container = builder.register(UsersRepository).build();

    await container.init();

    container.getOrThrow(UsersRepository).logger.debug('select');

    expect(spy.entries[0]?.fields).toEqual({ scope: 'UsersRepository' });
    expect(container.get(Logger$('UsersRepository'))).toBe(
      container.getOrThrow(UsersRepository).logger,
    );
  });
});

describe('секция nestlingLog', () => {
  it('уровень и формат читаются из NESTLING_LOG_LEVEL и NESTLING_LOG_FORMAT', async () => {
    const restore = withEnv({
      NESTLING_LOG_LEVEL: 'warn',
      NESTLING_LOG_FORMAT: 'json',
    });

    try {
      const builder = await kernelBuilder();
      const container = builder.build();

      await container.init();

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

  it('невалидный NESTLING_LOG_LEVEL роняет фазу 0 с перечнем значений', async () => {
    const restore = withEnv({ NESTLING_LOG_LEVEL: 'loud' });

    try {
      const reader = await bootstrapConfig();

      expect(() => makeKernelLogger(reader)).toThrow(ConfigValidationError);
      expect(() => makeKernelLogger(reader)).toThrow(
        /'debug', 'info', 'warn', 'error'.*got "loud"/s,
      );
    } finally {
      restore();
    }
  });

  it('логгер приложения снимает чтение секции: она не проверяется', async () => {
    const restore = withEnv({ NESTLING_LOG_LEVEL: 'loud' });

    try {
      const builder = await kernelBuilder({}, spyLogger().logger);
      const container = builder.build();

      await container.init();

      expect(container.get(RootLogger$)).not.toBeInstanceOf(ConsoleLogger);
    } finally {
      restore();
    }
  });
});
