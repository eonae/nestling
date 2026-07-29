import { makeToken } from '../common';
import { OnDestroy, OnInit } from '../lifecycle';
import { makeModule } from '../modules';
import {
  classProvider,
  factoryProvider,
  familyProvider,
  Injectable,
  makeTokenFamily,
  valueProvider,
} from '../providers';

import { ContainerBuilder } from './container.builder';

interface HealthCheck {
  name: string;
}

/** Names of the checks in the aggregate, in array order. */
const namesOf = (checks: readonly HealthCheck[]): string[] =>
  checks.map((check) => check.name);

describe('aggregate composition', () => {
  it('collects contributions registered by different modules', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'ComposedCheck',
    );

    @Injectable([])
    class DbCheck implements HealthCheck {
      readonly name = 'db';
    }

    @Injectable([])
    class RedisCheck implements HealthCheck {
      readonly name = 'redis';
    }

    @Injectable([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const DbModule = makeModule({
      name: 'module:db',
      providers: [classProvider(IHealthCheck('db'), DbCheck)],
    });

    const RedisModule = makeModule({
      name: 'module:redis',
      providers: [classProvider(IHealthCheck('redis'), RedisCheck)],
    });

    const container = await new ContainerBuilder()
      .register(DbModule, RedisModule)
      .register(HealthEndpoint)
      .build();

    const endpoint = container.getOrThrow(HealthEndpoint);

    // No familyProvider is registered: explicit contributions are enough.
    expect(namesOf(endpoint.checks)).toEqual(['db', 'redis']);
    expect(endpoint.checks[0]).toBe(container.getOrThrow(IHealthCheck('db')));
    expect(endpoint.checks[1]).toBe(
      container.getOrThrow(IHealthCheck('redis')),
    );
  });

  it('includes members materialized by the recipe and by .auto', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'MaterializedCheck',
    );

    @Injectable([IHealthCheck('db')])
    class DbConsumer {
      constructor(readonly check: HealthCheck) {}
    }

    @Injectable([IHealthCheck.auto])
    class AutoConsumer {
      constructor(readonly check: HealthCheck) {}
    }

    @Injectable([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    // Created, but nobody depends on it and it has no explicit provider.
    const orphan = IHealthCheck('orphan');

    const container = await new ContainerBuilder()
      .register(
        familyProvider(IHealthCheck, (name) =>
          valueProvider(IHealthCheck(name), { name }),
        ),
      )
      .register(DbConsumer, AutoConsumer, HealthEndpoint)
      .build();

    const endpoint = container.getOrThrow(HealthEndpoint);
    const json = await container.toJSON();

    expect(namesOf(endpoint.checks)).toEqual(['db', 'AutoConsumer']);
    expect(endpoint.checks[0]).toBe(container.getOrThrow(DbConsumer).check);
    expect(container.get(orphan)).toBeNull();
    expect(json.nodes.map((node) => node.id)).not.toContain(
      'MaterializedCheck:orphan',
    );
  });

  it('gives every consumer the same array and every member one slot', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'SharedCheck',
    );

    @Injectable([IHealthCheck.all])
    class FirstEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    @Injectable([IHealthCheck.all, IHealthCheck('db')])
    class SecondEndpoint {
      constructor(
        readonly checks: readonly HealthCheck[],
        readonly db: HealthCheck,
      ) {}
    }

    const container = await new ContainerBuilder()
      .register(valueProvider(IHealthCheck('db'), { name: 'db' }))
      .register(FirstEndpoint, SecondEndpoint)
      .build();

    const first = container.getOrThrow(FirstEndpoint);
    const second = container.getOrThrow(SecondEndpoint);
    const json = await container.toJSON();

    expect(first.checks).toBe(second.checks);
    expect(namesOf(first.checks)).toEqual(['db']);
    expect(first.checks[0]).toBe(second.db);
    expect(
      json.nodes.filter((node) => node.id === 'SharedCheck:{all}'),
    ).toHaveLength(1);
  });

  it('aggregates an empty family into an empty array', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'EmptyCheck',
    );

    @Injectable([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const container = await new ContainerBuilder()
      .register(HealthEndpoint)
      .build();

    const json = await container.toJSON();
    const aggregate = json.nodes.find((node) => node.id === 'EmptyCheck:{all}');

    expect(container.getOrThrow(HealthEndpoint).checks).toEqual([]);
    expect(aggregate).toBeDefined();
    expect(aggregate?.dependencies).toEqual([]);
  });

  it('freezes the aggregate array', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'FrozenCheck',
    );

    @Injectable([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const container = await new ContainerBuilder()
      .register(valueProvider(IHealthCheck('db'), { name: 'db' }))
      .register(HealthEndpoint)
      .build();

    const { checks } = container.getOrThrow(HealthEndpoint);

    expect(Object.isFrozen(checks)).toBe(true);
    expect(() => (checks as HealthCheck[]).push({ name: 'sneaky' })).toThrow(
      TypeError,
    );
    expect(namesOf(checks)).toEqual(['db']);
  });
});

describe('aggregate member order', () => {
  it('follows the registration order of the contributing modules', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'OrderedCheck',
    );

    const contributor = (name: string) =>
      makeModule({
        name: `module:${name}`,
        providers: [valueProvider(IHealthCheck(name), { name })],
      });

    @Injectable([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const container = await new ContainerBuilder()
      .register(contributor('a'), contributor('b'), contributor('c'))
      .register(HealthEndpoint)
      .build();

    expect(namesOf(container.getOrThrow(HealthEndpoint).checks)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('puts explicit contributions before materialized members', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'MixedOrderCheck',
    );

    @Injectable([IHealthCheck('redis')])
    class RedisConsumer {
      constructor(readonly check: HealthCheck) {}
    }

    @Injectable([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const container = await new ContainerBuilder()
      .register(
        familyProvider(IHealthCheck, (name) =>
          valueProvider(IHealthCheck(name), { name }),
        ),
      )
      .register(valueProvider(IHealthCheck('db'), { name: 'db' }))
      .register(RedisConsumer, HealthEndpoint)
      .build();

    expect(namesOf(container.getOrThrow(HealthEndpoint).checks)).toEqual([
      'db',
      'redis',
    ]);
  });
});

describe('aggregate is an ordinary graph node', () => {
  it('detects a cycle that runs through the aggregate', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'CyclicCheck',
    );

    @Injectable([IHealthCheck.all])
    class DbCheck implements HealthCheck {
      readonly name = 'db';

      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const builder = new ContainerBuilder().register(
      classProvider(IHealthCheck('db'), DbCheck),
    );

    await expect(builder.build()).rejects.toThrow(
      /Circular dependency.*CyclicCheck:{all}/s,
    );
  });

  it('runs lifecycle hooks of contributions around the consumer', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'HookedCheck',
    );
    const calls: string[] = [];

    @Injectable([])
    class DbCheck implements HealthCheck {
      readonly name = 'db';

      @OnInit()
      async initialize(): Promise<void> {
        calls.push('init:db');
      }

      @OnDestroy()
      async cleanup(): Promise<void> {
        calls.push('destroy:db');
      }
    }

    @Injectable([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}

      @OnInit()
      async initialize(): Promise<void> {
        calls.push('init:endpoint');
      }

      @OnDestroy()
      async cleanup(): Promise<void> {
        calls.push('destroy:endpoint');
      }
    }

    const container = await new ContainerBuilder()
      .register(classProvider(IHealthCheck('db'), DbCheck))
      .register(HealthEndpoint)
      .build();

    await container.init();
    await container.destroy();

    expect(calls).toEqual([
      'init:db',
      'init:endpoint',
      'destroy:endpoint',
      'destroy:db',
    ]);
  });

  it('appears in the graph with edges to its members', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'GraphCheck',
    );

    @Injectable([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const container = await new ContainerBuilder()
      .register(valueProvider(IHealthCheck('db'), { name: 'db' }))
      .register(valueProvider(IHealthCheck('redis'), { name: 'redis' }))
      .register(HealthEndpoint)
      .build();

    const json = await container.toJSON();
    const aggregate = json.nodes.find((node) => node.id === 'GraphCheck:{all}');

    const visited: string[] = [];
    await container.traverse((node) => {
      visited.push(node.id);
    });

    expect(aggregate?.dependencies).toEqual([
      'GraphCheck:db',
      'GraphCheck:redis',
    ]);
    expect(aggregate?.metadata.module).toBeUndefined();
    expect(visited).toContain('GraphCheck:{all}');
  });

  it('is allowed in the deps of a factory provider', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'FactoryCheck',
    );
    const IReport = makeToken<string>('FactoryCheckReport');

    const container = await new ContainerBuilder()
      .register(valueProvider(IHealthCheck('db'), { name: 'db' }))
      .register(
        factoryProvider(
          IReport,
          (checks: readonly HealthCheck[]) => namesOf(checks).join(','),
          [IHealthCheck.all] as const,
        ),
      )
      .build();

    expect(container.getOrThrow(IReport)).toBe('db');
  });

  it('creates no node when .all is not referenced', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'UnreferencedCheck',
    );

    @Injectable([IHealthCheck('db')])
    class DbConsumer {
      constructor(readonly check: HealthCheck) {}
    }

    const container = await new ContainerBuilder()
      .register(valueProvider(IHealthCheck('db'), { name: 'db' }))
      .register(DbConsumer)
      .build();

    const json = await container.toJSON();

    expect(container.get(IHealthCheck.all)).toBeNull();
    expect(json.nodes.map((node) => node.id)).not.toContain(
      'UnreferencedCheck:{all}',
    );
  });
});

describe('aggregate and strictExports', () => {
  it('rejects a contribution the owning module does not export', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'StrictCheck',
    );

    @Injectable([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const DbModule = makeModule({
      name: 'module:strict-db',
      providers: [valueProvider(IHealthCheck('db'), { name: 'db' })],
    });

    const builder = new ContainerBuilder({ strictExports: true })
      .register(DbModule)
      .register(HealthEndpoint);

    await expect(builder.build()).rejects.toThrow(
      `${IHealthCheck.all} → ${IHealthCheck('db')} (module:strict-db)`,
    );
  });

  it('accepts a contribution when the module exports the family', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'StrictExportedCheck',
    );

    @Injectable([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const DbModule = makeModule({
      name: 'module:strict-db-exported',
      providers: [valueProvider(IHealthCheck('db'), { name: 'db' })],
      exports: [IHealthCheck],
    });

    const container = await new ContainerBuilder({ strictExports: true })
      .register(DbModule)
      .register(HealthEndpoint)
      .build();

    expect(namesOf(container.getOrThrow(HealthEndpoint).checks)).toEqual([
      'db',
    ]);
  });
});

describe('the aggregate token is reserved', () => {
  it('rejects a hand-registered provider for .all', () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'ReservedCheck',
    );

    const builder = new ContainerBuilder();

    expect(() => builder.register(valueProvider(IHealthCheck.all, []))).toThrow(
      /'ReservedCheck:{all}' is reserved for the aggregate node of token family 'ReservedCheck'/,
    );
  });

  it('rejects a provider for .all declared by a module', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'ReservedModuleCheck',
    );

    const SneakyModule = makeModule({
      name: 'module:sneaky',
      providers: async () => [valueProvider(IHealthCheck.all, [])],
    });

    const builder = new ContainerBuilder().register(SneakyModule);

    await expect(builder.build()).rejects.toThrow(
      /'ReservedModuleCheck:{all}' is reserved for the aggregate node/,
    );
  });
});
