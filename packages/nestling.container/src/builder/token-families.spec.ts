import { makeToken } from '../common.js';
import { makeModule } from '../modules/index.js';
import {
  classProvider,
  Component,
  factoryProvider,
  familyProvider,
  makeTokenFamily,
  Resource,
  valueProvider,
} from '../providers/index.js';

import { ContainerBuilder } from './container.builder.js';

interface ILoggerService {
  scope: string;
}

interface IMetricsService {
  name: string;
}

describe('создание членов семейства', () => {
  it('вызывает рецепт один раз на параметр и разделяет экземпляр', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Dedup');
    const calls: string[] = [];
    const recipe = (scope: string) => {
      calls.push(scope);
      return valueProvider(ILogger(scope), { scope });
    };

    @Component([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    @Component([ILogger('users')])
    class ServiceB {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = new ContainerBuilder()
      .register(familyProvider(ILogger, recipe))
      .register(ServiceA, ServiceB)
      .build();

    await container.init();

    const json = await container.toJSON();

    expect(calls).toEqual(['users']);
    expect(json.nodes.filter((node) => node.id === 'Dedup:users')).toHaveLength(
      1,
    );
    expect(container.getOrThrow(ServiceA).logger).toBe(
      container.getOrThrow(ServiceB).logger,
    );
  });

  it('создаёт отдельный узел для каждого параметра', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'Distinct',
    );
    const calls: string[] = [];
    const recipe = (scope: string) => {
      calls.push(scope);
      return valueProvider(ILogger(scope), { scope });
    };

    @Component([ILogger('users'), ILogger('db')])
    class ServiceA {
      constructor(
        readonly users: ILoggerService,
        readonly db: ILoggerService,
      ) {}
    }

    const container = new ContainerBuilder()
      .register(familyProvider(ILogger, recipe))
      .register(ServiceA)
      .build();

    await container.init();

    expect([...calls].sort()).toEqual(['db', 'users']);

    const users = container.getOrThrow(ILogger('users'));
    const db = container.getOrThrow(ILogger('db'));

    expect(users.scope).toBe('users');
    expect(db.scope).toBe('db');
    expect(users).not.toBe(db);
  });

  it('завершает сбор, когда рецепт зависит от другого семейства', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'ChainLog',
    );
    const IMetrics = makeTokenFamily<IMetricsService, [name: string]>(
      'ChainMetrics',
    );

    @Component([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          factoryProvider(
            ILogger(scope),
            (metrics: IMetricsService) => ({
              scope: `${scope}/${metrics.name}`,
            }),
            [IMetrics(scope)] as const,
          ),
        ),
      )
      .register(
        familyProvider(IMetrics, (name) =>
          valueProvider(IMetrics(name), { name }),
        ),
      )
      .register(ServiceA)
      .build();

    await container.init();

    expect(container.getOrThrow(ILogger('users')).scope).toBe('users/users');
    expect(container.getOrThrow(IMetrics('users')).name).toBe('users');
  });

  it('не создаёт членов, от которых никто не зависит', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Orphan');

    @Component([ILogger('used')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    // DI-токен создан и есть в реестре семейства, но от него никто не зависит.
    const orphan = ILogger('orphan');

    const container = new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      )
      .register(ServiceA)
      .build();

    const json = await container.toJSON();

    expect(container.get(orphan)).toBeNull();
    expect(json.nodes.map((node) => node.id)).not.toContain('Orphan:orphan');
  });
});

describe('ошибки создания членов', () => {
  it('отклоняет рецепт, вернувший провайдер другого DI-токена', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Wrong');

    @Component([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const builder = new ContainerBuilder()
      .register(
        familyProvider(ILogger, () =>
          valueProvider(ILogger('other'), { scope: 'other' }),
        ),
      )
      .register(ServiceA);

    expect(() => builder.build()).toThrow(
      /family 'Wrong'.*parameter 'users'.*'Wrong:other'.*expected 'Wrong:users'/s,
    );
  });

  it('сообщает о члене, запрошенном без рецепта', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'NoRecipe',
    );

    @Component([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const builder = new ContainerBuilder().register(ServiceA);

    expect(() => builder.build()).toThrow(
      /'NoRecipe:users'.*family 'NoRecipe'.*parameter 'users'.*no familyProvider/s,
    );
  });

  it('отклоняет второй рецепт для того же семейства', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Twice');

    const builder = new ContainerBuilder().register(
      familyProvider(ILogger, (scope) =>
        valueProvider(ILogger(scope), { scope }),
      ),
    );

    expect(() =>
      builder.register(
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope: `other:${scope}` }),
        ),
      ),
    ).toThrow(/DI token family 'Twice' is already registered/);
  });

  it('пробрасывает ошибку рецепта как есть', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Boom');

    class RecipeError extends Error {}

    @Component([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const builder = new ContainerBuilder()
      .register(
        familyProvider(ILogger, () => {
          throw new RecipeError('recipe exploded');
        }),
      )
      .register(ServiceA);

    // Рецепт бывает и вычислением значения — например проекцией секции
    // конфига, — и тип его ошибки важнее места, где она случилась
    expect(() => builder.build()).toThrow(RecipeError);
    expect(() => builder.build()).toThrow('recipe exploded');
  });

  it('оборачивает не-ошибку из рецепта, называя семейство и параметр', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Thrown');

    @Component([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const builder = new ContainerBuilder()
      .register(
        familyProvider(ILogger, () => {
          throw 'not an error';
        }),
      )
      .register(ServiceA);

    expect(() => builder.build()).toThrow(
      /Recipe of DI token family 'Thrown' failed for parameter 'users'/,
    );
  });

  it('останавливает рецепт, который порождает членов бесконечно', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Endless');

    @Component([ILogger('a')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const builder = new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          factoryProvider(
            ILogger(scope),
            (next: ILoggerService) => ({ scope: next.scope }),
            [ILogger(`${scope}x`)] as const,
          ),
        ),
      )
      .register(ServiceA);

    expect(() => builder.build()).toThrow(/did not converge after 100 rounds/);
  });

  it('DI-токен из makeToken рецепту семейства не отдаётся', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'LookAlike',
    );
    const impostor = makeToken<ILoggerService>('LookAlike:users');

    @Component([impostor])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const builder = new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      )
      .register(ServiceA);

    // Членство читается полем DI-токена, поэтому похожий `id` семейство не
    // задевает: это обычная недостающая зависимость
    expect(() => builder.build()).toThrow(
      /Unsatisfied dependencies \(1\):[\S\s]*'LookAlike:users' required by 'ServiceA'/,
    );
  });
});

describe('члены семейства — обычные узлы графа', () => {
  it('находит цикл, проходящий через члена семейства', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Cyclic');
    const IServiceB = makeToken<{ id: string }>('CyclicServiceB');

    @Component([ILogger('a')])
    class ServiceB {
      readonly id = 'B';

      constructor(readonly logger: ILoggerService) {}
    }

    const builder = new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          factoryProvider(
            ILogger(scope),
            (b: { id: string }) => ({ scope: `${scope}/${b.id}` }),
            [IServiceB] as const,
          ),
        ),
      )
      .register(classProvider(IServiceB, ServiceB));

    expect(() => builder.build()).toThrow(
      /Cycles detected in the graph:[\S\s]*Cyclic:a[\S\s]*CyclicServiceB/,
    );
  });

  it('захватывает и освобождает члена ровно один раз', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Hooked');
    const calls: string[] = [];

    @Resource([])
    class HookedLogger implements ILoggerService {
      readonly scope = 'hooked';

      static async acquire(_signal: AbortSignal): Promise<HookedLogger> {
        calls.push('acquire');
        return new HookedLogger();
      }

      release(): void {
        calls.push('release');
      }
    }

    @Component([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          classProvider(ILogger(scope), HookedLogger),
        ),
      )
      .register(ServiceA)
      .build();

    await container.init();
    expect(calls).toEqual(['acquire']);

    await container.destroy();
    expect(calls).toEqual(['acquire', 'release']);
  });

  it('привязывает члена к модулю, зарегистрировавшему рецепт', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'Attributed',
    );

    @Component([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const LoggingModule = makeModule({
      name: 'module:logging',
      providers: [
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      ],
    });

    const container = new ContainerBuilder()
      .register(LoggingModule)
      .register(ServiceA)
      .build();

    const json = await container.toJSON();
    const member = json.nodes.find((node) => node.id === 'Attributed:users');

    expect(member?.metadata.module).toBe('module:logging');
  });

  it('оставляет члена без модуля, если рецепт зарегистрирован напрямую', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'Moduleless',
    );

    @Component([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      )
      .register(ServiceA)
      .build();

    const json = await container.toJSON();
    const member = json.nodes.find((node) => node.id === 'Moduleless:users');

    expect(member?.metadata.module).toBeUndefined();
  });

  it('принимает рецепт из фабрики провайдеров модуля', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'FromFactory',
    );

    @Component([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const LoggingModule = makeModule({
      name: 'module:logging-factory',
      providers: () => [
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      ],
    });

    const container = new ContainerBuilder()
      .register(LoggingModule)
      .register(ServiceA)
      .build();

    await container.init();

    expect(container.getOrThrow(ILogger('users')).scope).toBe('users');
  });
});
