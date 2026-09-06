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

interface HealthCheck {
  name: string;
}

/** Имена проверок агрегата в порядке массива. */
const namesOf = (checks: readonly HealthCheck[]): string[] =>
  checks.map((check) => check.name);

describe('состав агрегата', () => {
  it('собирает членов, зарегистрированных разными модулями', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'ComposedCheck',
    );

    @Component([])
    class DbCheck implements HealthCheck {
      readonly name = 'db';
    }

    @Component([])
    class RedisCheck implements HealthCheck {
      readonly name = 'redis';
    }

    @Component([IHealthCheck.all])
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

    const container = new ContainerBuilder()
      .register(DbModule, RedisModule)
      .register(HealthEndpoint)
      .build();

    await container.init();

    const endpoint = container.getOrThrow(HealthEndpoint);

    // Рецепт семейства не зарегистрирован: явных провайдеров достаточно.
    expect(namesOf(endpoint.checks)).toEqual(['db', 'redis']);
    expect(endpoint.checks[0]).toBe(container.getOrThrow(IHealthCheck('db')));
    expect(endpoint.checks[1]).toBe(
      container.getOrThrow(IHealthCheck('redis')),
    );
  });

  it('включает членов, созданных рецептом и через .auto', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'MaterializedCheck',
    );

    @Component([IHealthCheck('db')])
    class DbConsumer {
      constructor(readonly check: HealthCheck) {}
    }

    @Component([IHealthCheck.auto])
    class AutoConsumer {
      constructor(readonly check: HealthCheck) {}
    }

    @Component([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    // DI-токен создан, но от него никто не зависит и провайдера у него нет.
    const orphan = IHealthCheck('orphan');

    const container = new ContainerBuilder()
      .register(
        familyProvider(IHealthCheck, (name) =>
          valueProvider(IHealthCheck(name), { name }),
        ),
      )
      .register(DbConsumer, AutoConsumer, HealthEndpoint)
      .build();

    await container.init();

    const endpoint = container.getOrThrow(HealthEndpoint);
    const json = await container.toJSON();

    expect(namesOf(endpoint.checks)).toEqual(['db', 'AutoConsumer']);
    expect(endpoint.checks[0]).toBe(container.getOrThrow(DbConsumer).check);
    expect(container.get(orphan)).toBeNull();
    expect(json.nodes.map((node) => node.id)).not.toContain(
      'MaterializedCheck:orphan',
    );
  });

  it('отдаёт всем потребителям один массив, где каждый член один раз', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'SharedCheck',
    );

    @Component([IHealthCheck.all])
    class FirstEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    @Component([IHealthCheck.all, IHealthCheck('db')])
    class SecondEndpoint {
      constructor(
        readonly checks: readonly HealthCheck[],
        readonly db: HealthCheck,
      ) {}
    }

    const container = new ContainerBuilder()
      .register(valueProvider(IHealthCheck('db'), { name: 'db' }))
      .register(FirstEndpoint, SecondEndpoint)
      .build();

    await container.init();

    const first = container.getOrThrow(FirstEndpoint);
    const second = container.getOrThrow(SecondEndpoint);
    const json = await container.toJSON();

    expect(first.checks).toBe(second.checks);
    expect(namesOf(first.checks)).toEqual(['db']);
    expect(first.checks[0]).toBe(second.db);
    expect(
      json.nodes.filter((node) => node.id === 'SharedCheck.all'),
    ).toHaveLength(1);
  });

  it('собирает пустое семейство в пустой массив', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'EmptyCheck',
    );

    @Component([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const container = new ContainerBuilder().register(HealthEndpoint).build();

    await container.init();

    const json = await container.toJSON();
    const aggregate = json.nodes.find((node) => node.id === 'EmptyCheck.all');

    expect(container.getOrThrow(HealthEndpoint).checks).toEqual([]);
    expect(aggregate).toBeDefined();
    expect(aggregate?.dependencies).toEqual([]);
  });

  it('замораживает массив агрегата', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'FrozenCheck',
    );

    @Component([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const container = new ContainerBuilder()
      .register(valueProvider(IHealthCheck('db'), { name: 'db' }))
      .register(HealthEndpoint)
      .build();

    await container.init();

    const { checks } = container.getOrThrow(HealthEndpoint);

    expect(Object.isFrozen(checks)).toBe(true);
    expect(() => (checks as HealthCheck[]).push({ name: 'sneaky' })).toThrow(
      TypeError,
    );
    expect(namesOf(checks)).toEqual(['db']);
  });
});

describe('порядок членов агрегата', () => {
  it('следует порядку регистрации модулей', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'OrderedCheck',
    );

    const contributor = (name: string) =>
      makeModule({
        name: `module:${name}`,
        providers: [valueProvider(IHealthCheck(name), { name })],
      });

    @Component([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const container = new ContainerBuilder()
      .register(contributor('a'), contributor('b'), contributor('c'))
      .register(HealthEndpoint)
      .build();

    await container.init();

    expect(namesOf(container.getOrThrow(HealthEndpoint).checks)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('ставит явные провайдеры раньше членов, созданных рецептом', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'MixedOrderCheck',
    );

    @Component([IHealthCheck('redis')])
    class RedisConsumer {
      constructor(readonly check: HealthCheck) {}
    }

    @Component([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const container = new ContainerBuilder()
      .register(
        familyProvider(IHealthCheck, (name) =>
          valueProvider(IHealthCheck(name), { name }),
        ),
      )
      .register(valueProvider(IHealthCheck('db'), { name: 'db' }))
      .register(RedisConsumer, HealthEndpoint)
      .build();

    await container.init();

    expect(namesOf(container.getOrThrow(HealthEndpoint).checks)).toEqual([
      'db',
      'redis',
    ]);
  });
});

describe('агрегат — обычный узел графа', () => {
  it('находит цикл, проходящий через агрегат', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'CyclicCheck',
    );

    @Component([IHealthCheck.all])
    class DbCheck implements HealthCheck {
      readonly name = 'db';

      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const builder = new ContainerBuilder().register(
      classProvider(IHealthCheck('db'), DbCheck),
    );

    expect(() => builder.build()).toThrow(
      /Cycles detected in the graph:[\S\s]*CyclicCheck.all[\S\s]*CyclicCheck:db/,
    );
  });

  it('захватывает членов раньше потребителя и освобождает их позже', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'HookedCheck',
    );
    const calls: string[] = [];

    @Resource([])
    class DbCheck implements HealthCheck {
      readonly name = 'db';

      static async acquire(_signal: AbortSignal): Promise<DbCheck> {
        calls.push('acquire:db');
        return new DbCheck();
      }

      release(): void {
        calls.push('release:db');
      }
    }

    @Resource([IHealthCheck.all] as const)
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}

      static async acquire(
        checks: readonly HealthCheck[],
        _signal: AbortSignal,
      ): Promise<HealthEndpoint> {
        calls.push('acquire:endpoint');
        return new HealthEndpoint(checks);
      }

      release(): void {
        calls.push('release:endpoint');
      }
    }

    const container = new ContainerBuilder()
      .register(classProvider(IHealthCheck('db'), DbCheck))
      .register(HealthEndpoint)
      .build();

    await container.init();
    await container.destroy();

    expect(calls).toEqual([
      'acquire:db',
      'acquire:endpoint',
      'release:endpoint',
      'release:db',
    ]);
  });

  it('появляется в графе с рёбрами к членам', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'GraphCheck',
    );

    @Component([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const container = new ContainerBuilder()
      .register(valueProvider(IHealthCheck('db'), { name: 'db' }))
      .register(valueProvider(IHealthCheck('redis'), { name: 'redis' }))
      .register(HealthEndpoint)
      .build();

    const json = await container.toJSON();
    const aggregate = json.nodes.find((node) => node.id === 'GraphCheck.all');

    const visited: string[] = [];
    await container.traverse((node) => {
      visited.push(node.id);
    });

    expect(aggregate?.dependencies).toEqual([
      'GraphCheck:db',
      'GraphCheck:redis',
    ]);
    expect(aggregate?.metadata.module).toBeUndefined();
    expect(visited).toContain('GraphCheck.all');
  });

  it('разрешён в deps фабричного провайдера', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'FactoryCheck',
    );
    const IReport = makeToken<string>('FactoryCheckReport');

    const container = new ContainerBuilder()
      .register(valueProvider(IHealthCheck('db'), { name: 'db' }))
      .register(
        factoryProvider(
          IReport,
          (checks: readonly HealthCheck[]) => namesOf(checks).join(','),
          [IHealthCheck.all] as const,
        ),
      )
      .build();

    await container.init();

    expect(container.getOrThrow(IReport)).toBe('db');
  });

  it('не создаёт узел, если .all никто не запросил', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'UnreferencedCheck',
    );

    @Component([IHealthCheck('db')])
    class DbConsumer {
      constructor(readonly check: HealthCheck) {}
    }

    const container = new ContainerBuilder()
      .register(valueProvider(IHealthCheck('db'), { name: 'db' }))
      .register(DbConsumer)
      .build();

    const json = await container.toJSON();

    expect(container.get(IHealthCheck.all)).toBeNull();
    expect(json.nodes.map((node) => node.id)).not.toContain(
      'UnreferencedCheck.all',
    );
  });
});

describe('агрегат и модули', () => {
  it('забирает вклад чужого модуля без объявления', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'CrossModuleCheck',
    );

    @Component([IHealthCheck.all])
    class HealthEndpoint {
      constructor(readonly checks: readonly HealthCheck[]) {}
    }

    const DbModule = makeModule({
      name: 'module:cross-db',
      providers: [valueProvider(IHealthCheck('db'), { name: 'db' })],
    });

    const ApiModule = makeModule({
      name: 'module:cross-api',
      providers: [HealthEndpoint],
    });

    const container = new ContainerBuilder()
      .register(DbModule)
      .register(ApiModule)
      .build();

    await container.init();

    expect(namesOf(container.getOrThrow(HealthEndpoint).checks)).toEqual([
      'db',
    ]);
  });
});

describe('DI-токен агрегата зарезервирован', () => {
  it('отклоняет провайдер для .all, зарегистрированный вручную', () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'ReservedCheck',
    );

    const builder = new ContainerBuilder();

    expect(() => builder.register(valueProvider(IHealthCheck.all, []))).toThrow(
      /'ReservedCheck.all' is reserved for the aggregate node of DI token family 'ReservedCheck'/,
    );
  });

  it('отклоняет провайдер для .all, объявленный модулем', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'ReservedModuleCheck',
    );

    const SneakyModule = makeModule({
      name: 'module:sneaky',
      providers: () => [valueProvider(IHealthCheck.all, [])],
    });

    const builder = new ContainerBuilder().register(SneakyModule);

    expect(() => builder.build()).toThrow(
      /'ReservedModuleCheck.all' is reserved for the aggregate node/,
    );
  });
});
