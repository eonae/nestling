import { makeToken } from '../common';
import { OnDestroy, OnInit } from '../lifecycle';
import { makeModule } from '../modules';
import {
  factoryProvider,
  familyProvider,
  Injectable,
  makeTokenFamily,
  valueProvider,
} from '../providers';

import { ContainerBuilder } from './container.builder';

interface ILoggerService {
  scope: string;
}

interface IMetricsService {
  name: string;
}

describe('family member materialization', () => {
  it('calls the recipe once per parameter and shares the instance', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Dedup');
    const calls: string[] = [];
    const recipe = (scope: string) => {
      calls.push(scope);
      return valueProvider(ILogger(scope), { scope });
    };

    @Injectable([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    @Injectable([ILogger('users')])
    class ServiceB {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = await new ContainerBuilder()
      .register(familyProvider(ILogger, recipe))
      .register(ServiceA, ServiceB)
      .build();

    const json = await container.toJSON();

    expect(calls).toEqual(['users']);
    expect(json.nodes.filter((node) => node.id === 'Dedup:users')).toHaveLength(
      1,
    );
    expect(container.getOrThrow(ServiceA).logger).toBe(
      container.getOrThrow(ServiceB).logger,
    );
  });

  it('materializes distinct parameters as distinct nodes', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'Distinct',
    );
    const calls: string[] = [];
    const recipe = (scope: string) => {
      calls.push(scope);
      return valueProvider(ILogger(scope), { scope });
    };

    @Injectable([ILogger('users'), ILogger('db')])
    class ServiceA {
      constructor(
        readonly users: ILoggerService,
        readonly db: ILoggerService,
      ) {}
    }

    const container = await new ContainerBuilder()
      .register(familyProvider(ILogger, recipe))
      .register(ServiceA)
      .build();

    expect([...calls].sort()).toEqual(['db', 'users']);

    const users = container.getOrThrow(ILogger('users'));
    const db = container.getOrThrow(ILogger('db'));

    expect(users.scope).toBe('users');
    expect(db.scope).toBe('db');
    expect(users).not.toBe(db);
  });

  it('reaches a fixpoint when a recipe depends on another family', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'ChainLog',
    );
    const IMetrics = makeTokenFamily<IMetricsService, [name: string]>(
      'ChainMetrics',
    );

    @Injectable([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = await new ContainerBuilder()
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

    expect(container.getOrThrow(ILogger('users')).scope).toBe('users/users');
    expect(container.getOrThrow(IMetrics('users')).name).toBe('users');
  });

  it('does not materialize members nobody depends on', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Orphan');

    @Injectable([ILogger('used')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    // The token exists (and is in the family registry), but nothing depends on it.
    const orphan = ILogger('orphan');

    const container = await new ContainerBuilder()
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

describe('family materialization errors', () => {
  it('rejects a recipe that provides a different token', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Wrong');

    @Injectable([ILogger('users')])
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

    await expect(builder.build()).rejects.toThrow(
      /family 'Wrong'.*parameter 'users'.*'Wrong:other'.*expected 'Wrong:users'/s,
    );
  });

  it('reports a member requested without a registered recipe', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'NoRecipe',
    );

    @Injectable([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const builder = new ContainerBuilder().register(ServiceA);

    await expect(builder.build()).rejects.toThrow(
      /'NoRecipe:users'.*family 'NoRecipe'.*parameter 'users'.*no familyProvider/s,
    );
  });

  it('rejects a second recipe for the same family', () => {
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
    ).toThrow(/token family 'Twice' is already registered/);
  });

  it('wraps an error thrown by the recipe with family context', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Boom');

    @Injectable([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const builder = new ContainerBuilder()
      .register(
        familyProvider(ILogger, () => {
          throw new Error('recipe exploded');
        }),
      )
      .register(ServiceA);

    await expect(builder.build()).rejects.toThrow(
      /Recipe of token family 'Boom' failed for parameter 'users'/,
    );
  });

  it('stops a recipe that keeps producing new members', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Endless');

    @Injectable([ILogger('a')])
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

    await expect(builder.build()).rejects.toThrow(
      /did not converge after 100 rounds/,
    );
  });

  it('hints at the family for a look-alike token built with makeToken', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'LookAlike',
    );
    const impostor = makeToken<ILoggerService>('LookAlike:users');

    @Injectable([impostor])
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

    await expect(builder.build()).rejects.toThrow(
      /looks like a member of token family 'LookAlike'/,
    );
  });
});

describe('family members are ordinary graph nodes', () => {
  it('detects a cycle that runs through a family member', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Cyclic');
    const IServiceB = makeToken<{ id: string }>('CyclicServiceB');

    @Injectable(IServiceB, [ILogger('a')])
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
      .register(ServiceB);

    await expect(builder.build()).rejects.toThrow(/Circular dependency/);
  });

  it('runs lifecycle hooks of a member exactly once', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Hooked');
    const calls: string[] = [];

    @Injectable([])
    class HookedLogger implements ILoggerService {
      readonly scope = 'hooked';

      @OnInit()
      async initialize(): Promise<void> {
        calls.push('init');
      }

      @OnDestroy()
      async cleanup(): Promise<void> {
        calls.push('destroy');
      }
    }

    @Injectable([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = await new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) => ({
          provide: ILogger(scope),
          useClass: HookedLogger,
          deps: [],
        })),
      )
      .register(ServiceA)
      .build();

    await container.init();
    expect(calls).toEqual(['init']);

    await container.destroy();
    expect(calls).toEqual(['init', 'destroy']);
  });

  it('attributes a member to the module that registered the recipe', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'Attributed',
    );

    @Injectable([ILogger('users')])
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

    const container = await new ContainerBuilder()
      .register(LoggingModule)
      .register(ServiceA)
      .build();

    const json = await container.toJSON();
    const member = json.nodes.find((node) => node.id === 'Attributed:users');

    expect(member?.metadata.module).toBe('module:logging');
  });

  it('leaves a member without a module when the recipe is registered directly', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'Moduleless',
    );

    @Injectable([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = await new ContainerBuilder()
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

  it('accepts a family recipe from a module providers factory', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'FromFactory',
    );

    @Injectable([ILogger('users')])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const LoggingModule = makeModule({
      name: 'module:logging-factory',
      providers: async () => [
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      ],
    });

    const container = await new ContainerBuilder()
      .register(LoggingModule)
      .register(ServiceA)
      .build();

    expect(container.getOrThrow(ILogger('users')).scope).toBe('users');
  });
});
