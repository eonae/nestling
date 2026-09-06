import { makeToken } from '../common.js';
import { makeModule } from '../modules/index.js';
import {
  classProvider,
  factoryProvider,
  Injectable,
  valueProvider,
} from '../providers/index.js';

import { ContainerBuilder } from './container.builder.js';

interface Logger {
  readonly kind: string;
}

const RootLogger$ = makeToken<Logger>('RootLogger');

@Injectable([])
class ConsoleLogger implements Logger {
  readonly kind = 'console';
}

const custom: Logger = { kind: 'custom' };

/** Модуль ядра: объявляет реализацию по умолчанию, а не провайдер */
const loggerKernel = makeModule({
  name: 'kernel:logger',
  defaults: [classProvider(RootLogger$, ConsoleLogger)],
});

describe('умолчания модуля', () => {
  it('без соперника умолчание попадает в граф и атрибутируется модулю', async () => {
    const container = await new ContainerBuilder()
      .register(loggerKernel)
      .build();

    expect(container.get(RootLogger$)).toBeInstanceOf(ConsoleLogger);

    const { nodes } = await container.toJSON();
    const node = nodes.find((n) => n.id === 'RootLogger');

    expect(node?.metadata.module).toBe('kernel:logger');
    expect(container.warnings).toEqual([]);
  });

  it('провайдер модуля побеждает умолчание, зарегистрированное раньше', async () => {
    const plugin = makeModule({
      name: 'plugin:logging',
      providers: [factoryProvider(RootLogger$, () => custom, [])],
    });

    const container = await new ContainerBuilder()
      .register(loggerKernel)
      .register(plugin)
      .build();

    expect(container.get(RootLogger$)).toBe(custom);
  });

  it('провайдер модуля побеждает умолчание, зарегистрированное позже', async () => {
    const plugin = makeModule({
      name: 'plugin:logging',
      providers: [factoryProvider(RootLogger$, () => custom, [])],
    });

    const container = await new ContainerBuilder()
      .register(plugin)
      .register(loggerKernel)
      .build();

    expect(container.get(RootLogger$)).toBe(custom);
  });

  it('провайдер из register() побеждает умолчание', async () => {
    const container = await new ContainerBuilder()
      .register(loggerKernel)
      .register(valueProvider(RootLogger$, custom))
      .build();

    expect(container.get(RootLogger$)).toBe(custom);
  });

  it('провайдер из фабрики провайдеров модуля побеждает умолчание', async () => {
    const plugin = makeModule({
      name: 'plugin:logging',
      providers: () => [factoryProvider(RootLogger$, () => custom, [])],
    });

    const container = await new ContainerBuilder()
      .register(loggerKernel)
      .register(plugin)
      .build();

    expect(container.get(RootLogger$)).toBe(custom);

    const { nodes } = await container.toJSON();
    const node = nodes.find((n) => n.id === 'RootLogger');

    expect(node?.metadata.module).toBe('plugin:logging');
  });

  it('подстановка находит умолчание', async () => {
    const spy: Logger = { kind: 'spy' };

    const container = await new ContainerBuilder({
      overrides: [[RootLogger$, spy]],
    })
      .register(loggerKernel)
      .build();

    expect(container.get(RootLogger$)).toBe(spy);
  });

  it('умолчание участвует в графе как обычный узел', async () => {
    const Service$ = makeToken<{ logger: Logger }>('Service');

    const container = await new ContainerBuilder()
      .register(loggerKernel)
      .register(
        factoryProvider(Service$, (logger) => ({ logger }), [RootLogger$]),
      )
      .build();

    expect(container.getOrThrow(Service$).logger).toBeInstanceOf(ConsoleLogger);
  });

  it('два умолчания под одним токеном — ошибка регистрации с именами модулей', () => {
    const other = makeModule({
      name: 'plugin:other-logger',
      defaults: [valueProvider(RootLogger$, custom)],
    });

    expect(() =>
      new ContainerBuilder().register(loggerKernel).register(other),
    ).toThrow(
      /'kernel:logger' and 'plugin:other-logger' both declare a default for token 'RootLogger'/,
    );
  });

  it('умолчание без @Injectable отклоняется при регистрации', () => {
    class Bare {
      readonly kind = 'bare';
    }

    const broken = makeModule({
      name: 'broken',
      defaults: [Bare],
    });

    expect(() => new ContainerBuilder().register(broken)).toThrow(
      /missing @Injectable/,
    );
  });
});
