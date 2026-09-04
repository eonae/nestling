import { makeToken } from '../common.js';
import { OnDestroy, OnInit } from '../lifecycle/index.js';
import { makeModule } from '../modules/index.js';
import {
  classProvider,
  factoryProvider,
  familyProvider,
  Injectable,
  makeTokenFamily,
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

    // Токен создан, но от него никто не зависит и провайдера у него нет.
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

  it('отдаёт всем потребителям один массив, где каждый член один раз', async () => {
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
      json.nodes.filter((node) => node.id === 'SharedCheck.all'),
    ).toHaveLength(1);
  });

  it('собирает пустое семейство в пустой массив', async () => {
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
    const aggregate = json.nodes.find((node) => node.id === 'EmptyCheck.all');

    expect(container.getOrThrow(HealthEndpoint).checks).toEqual([]);
    expect(aggregate).toBeDefined();
    expect(aggregate?.dependencies).toEqual([]);
  });

  it('замораживает массив агрегата', async () => {
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

  it('ставит явные провайдеры раньше членов, созданных рецептом', async () => {
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

describe('агрегат — обычный узел графа', () => {
  it('находит цикл, проходящий через агрегат', async () => {
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
      /Circular dependency.*CyclicCheck.all/s,
    );
  });

  it('выполняет хуки членов раньше потребителя при init и позже при destroy', async () => {
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

  it('появляется в графе с рёбрами к членам', async () => {
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

  it('не создаёт узел, если .all никто не запросил', async () => {
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
      'UnreferencedCheck.all',
    );
  });
});

describe('агрегат и модули', () => {
  it('забирает вклад чужого модуля без объявления', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'CrossModuleCheck',
    );

    @Injectable([IHealthCheck.all])
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

    const container = await new ContainerBuilder()
      .register(DbModule)
      .register(ApiModule)
      .build();

    expect(namesOf(container.getOrThrow(HealthEndpoint).checks)).toEqual([
      'db',
    ]);
  });
});

describe('токен агрегата зарезервирован', () => {
  it('отклоняет провайдер для .all, зарегистрированный вручную', () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'ReservedCheck',
    );

    const builder = new ContainerBuilder();

    expect(() => builder.register(valueProvider(IHealthCheck.all, []))).toThrow(
      /'ReservedCheck.all' is reserved for the aggregate node of token family 'ReservedCheck'/,
    );
  });

  it('отклоняет провайдер для .all, объявленный модулем', async () => {
    const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
      'ReservedModuleCheck',
    );

    const SneakyModule = makeModule({
      name: 'module:sneaky',
      providers: async () => [valueProvider(IHealthCheck.all, [])],
    });

    const builder = new ContainerBuilder().register(SneakyModule);

    await expect(builder.build()).rejects.toThrow(
      /'ReservedModuleCheck.all' is reserved for the aggregate node/,
    );
  });
});
