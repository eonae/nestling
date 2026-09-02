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

/**
 * Подстановка узлов и прунинг со стороны контейнера: замена узла значением,
 * удаление осиротевшего поддерева и перечень недостающих зависимостей.
 *
 * Тесты проверяют наблюдаемые следствия: какие конструкторы выполнились,
 * что осталось в `toJSON()`, в каком порядке отработали хуки. Внутренние
 * структуры билдера не проверяются.
 */

interface IRepository {
  find(id: string): string;
}

interface IPool {
  query(): string;
}

const Repository = makeToken<IRepository>('Repository');
const Pool = makeToken<IPool>('Pool');
const Reports = makeToken<{ build(): string }>('Reports');

describe('overrides: подстановка узла графа', () => {
  it('не вызывает конструктор боевого провайдера ни разу', async () => {
    let constructed = 0;

    @Injectable(Pool, [])
    class PgPool implements IPool {
      constructor() {
        constructed += 1;
      }

      query(): string {
        return 'real';
      }
    }

    @Injectable(Repository, [Pool] as const)
    class PgRepository implements IRepository {
      constructor(private readonly pool: IPool) {}

      find(): string {
        return this.pool.query();
      }
    }

    const container = await new ContainerBuilder({
      overrides: [[Repository, { find: () => 'fake' }]],
    })
      .register(PgPool, PgRepository)
      .build();

    expect(constructed).toBe(0);
    expect(container.getOrThrow(Repository).find('1')).toBe('fake');
  });

  it('делает подставленное значение обычным узлом с хуками в общем порядке', async () => {
    const order: string[] = [];

    class FakeRepository implements IRepository {
      @OnInit()
      open(): void {
        order.push('init:fake');
      }

      @OnDestroy()
      close(): void {
        order.push('destroy:fake');
      }

      find(): string {
        return 'fake';
      }
    }

    @Injectable([Repository] as const)
    class Service {
      constructor(readonly repository: IRepository) {}

      @OnInit()
      warmup(): void {
        order.push('init:service');
      }

      @OnDestroy()
      drain(): void {
        order.push('destroy:service');
      }
    }

    @Injectable(Repository, [])
    class RealRepository implements IRepository {
      find(): string {
        return 'real';
      }
    }

    const container = await new ContainerBuilder({
      overrides: [[Repository, new FakeRepository()]],
    })
      .register(RealRepository, Service)
      .build();

    await container.init();
    await container.destroy();

    expect(order).toEqual([
      'init:fake',
      'init:service',
      'destroy:service',
      'destroy:fake',
    ]);
  });

  it('сохраняет модуль-владелец заменённого узла', async () => {
    @Injectable(Repository, [])
    class RealRepository implements IRepository {
      find(): string {
        return 'real';
      }
    }

    const UsersModule = makeModule({
      name: 'users',
      providers: [RealRepository],
    });

    const container = await new ContainerBuilder({
      overrides: [[Repository, { find: () => 'fake' }]],
    })
      .register(UsersModule)
      .build();

    const { nodes } = await container.toJSON();
    const node = nodes.find((candidate) => candidate.id === 'Repository');

    expect(node?.metadata).toEqual({ module: 'users' });
  });

  it('падает на override токена, которого нет в графе', async () => {
    const Missing = makeToken<string>('Missing');

    const builder = new ContainerBuilder({
      overrides: [[Missing, 'fake']],
    }).register(valueProvider(Repository, { find: () => 'real' }));

    await expect(builder.build()).rejects.toThrow(
      /Override targets token 'Missing', but no provider for it is registered\..*modules and features/s,
    );
  });

  it('объясняет отдельно, почему нет неинжектированного члена семейства', async () => {
    const ILogger = makeTokenFamily<{ scope: string }, [scope: string]>(
      'OverrideLogger',
    );

    const builder = new ContainerBuilder({
      overrides: [[ILogger('nobody-injects-me'), { scope: 'fake' }]],
    })
      .register(
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      )
      .register(valueProvider(Repository, { find: () => 'real' }));

    await expect(builder.build()).rejects.toThrow(
      /member of token family 'OverrideLogger'.*only once something injects it/s,
    );
  });

  it('падает на двух override одного токена', async () => {
    const builder = new ContainerBuilder({
      overrides: [
        [Repository, { find: () => 'first' }],
        [Repository, { find: () => 'second' }],
      ],
    }).register(valueProvider(Repository, { find: () => 'real' }));

    await expect(builder.build()).rejects.toThrow(
      /Token 'Repository' is overridden twice/,
    );
  });
});

describe('familyOverrides: подмена рецепта семейства', () => {
  it('создаёт всех членов тестовым рецептом, боевой не вызывается', async () => {
    interface ILoggerService {
      readonly kind: string;
      readonly scope: string;
    }

    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'FamilyOverrideLogger',
    );

    let productionCalls = 0;

    @Injectable([ILogger('users'), ILogger('orders'), ILogger('billing')])
    class Service {
      constructor(
        readonly users: ILoggerService,
        readonly orders: ILoggerService,
        readonly billing: ILoggerService,
      ) {}
    }

    const container = await new ContainerBuilder({
      familyOverrides: [
        {
          family: ILogger,
          recipe: (scope: string) =>
            valueProvider(ILogger(scope), { kind: 'test', scope }),
        },
      ],
    })
      .register(
        familyProvider(ILogger, (scope) => {
          productionCalls += 1;
          return valueProvider(ILogger(scope), { kind: 'production', scope });
        }),
      )
      .register(Service)
      .build();

    const service = container.getOrThrow(Service);

    expect(productionCalls).toBe(0);
    expect([service.users, service.orders, service.billing]).toEqual([
      { kind: 'test', scope: 'users' },
      { kind: 'test', scope: 'orders' },
      { kind: 'test', scope: 'billing' },
    ]);
  });

  it('падает на двух подменах одного семейства', async () => {
    const ILogger = makeTokenFamily<{ scope: string }, [scope: string]>(
      'DoubleOverrideLogger',
    );

    const recipe = (scope: string) => valueProvider(ILogger(scope), { scope });

    const builder = new ContainerBuilder({
      familyOverrides: [
        { family: ILogger, recipe },
        { family: ILogger, recipe },
      ],
    }).register(valueProvider(Repository, { find: () => 'real' }));

    await expect(builder.build()).rejects.toThrow(
      /Token family 'DoubleOverrideLogger' is overridden twice/,
    );
  });
});

describe('прунинг: без overrides сборка тождественна', () => {
  it('оставляет все узлы, их зависимости и порядок хуков', async () => {
    const order: string[] = [];

    interface ISink {
      readonly scope: string;
    }

    const ISinkFamily = makeTokenFamily<ISink, [scope: string]>('IdentitySink');
    const Aggregated = makeToken<readonly ISink[]>('Aggregated');
    const Orphan = makeToken<{ id: string }>('Orphan');

    @Injectable(Pool, [])
    class PgPool implements IPool {
      @OnInit()
      connect(): void {
        order.push('init:Pool');
      }

      @OnDestroy()
      disconnect(): void {
        order.push('destroy:Pool');
      }

      query(): string {
        return 'real';
      }
    }

    @Injectable(Repository, [Pool, ISinkFamily('repo')] as const)
    class PgRepository implements IRepository {
      constructor(
        private readonly pool: IPool,
        readonly sink: ISink,
      ) {}

      @OnInit()
      warmup(): void {
        order.push('init:Repository');
      }

      @OnDestroy()
      drain(): void {
        order.push('destroy:Repository');
      }

      find(): string {
        return this.pool.query();
      }
    }

    @Injectable(Reports, [Pool] as const)
    class ReportsService {
      constructor(private readonly pool: IPool) {}

      build(): string {
        return this.pool.query();
      }
    }

    const DataModule = makeModule({
      name: 'data',
      providers: [
        PgPool,
        PgRepository,
        ReportsService,
        familyProvider(ISinkFamily, (scope) =>
          valueProvider(ISinkFamily(scope), { scope }),
        ),
        factoryProvider(Aggregated, (sinks: readonly ISink[]) => sinks, [
          ISinkFamily.all,
        ] as const),
        // Узел без потребителей остаётся в графе: жадный контейнер создаёт
        // всё зарегистрированное, прунинг удаляет только осиротевшее
        valueProvider(Orphan, { id: 'orphan' }),
      ],
    });

    const container = await new ContainerBuilder().register(DataModule).build();

    await container.init();
    await container.destroy();

    const { nodes } = await container.toJSON();
    const byId = new Map(nodes.map((node) => [node.id, node.dependencies]));

    expect([...byId.keys()].sort()).toEqual(
      [
        'Aggregated',
        'IdentitySink:repo',
        'IdentitySink.all',
        'Orphan',
        'Pool',
        'Reports',
        'Repository',
      ].sort(),
    );
    expect(byId.get('Repository')).toEqual(['Pool', 'IdentitySink:repo']);
    expect(byId.get('Reports')).toEqual(['Pool']);
    expect(byId.get('Aggregated')).toEqual(['IdentitySink.all']);
    expect(byId.get('IdentitySink.all')).toEqual(['IdentitySink:repo']);

    expect(container.pruned).toEqual([]);
    expect(order).toEqual([
      'init:Pool',
      'init:Repository',
      'destroy:Repository',
      'destroy:Pool',
    ]);
  });

  it('оставляет цикл детектору циклов, а не прунингу', async () => {
    const TokenX = makeToken<{ id: string }>('CycleX');
    const TokenY = makeToken<{ id: string }>('CycleY');

    const builder = new ContainerBuilder()
      .register(factoryProvider(TokenX, () => ({ id: 'x' }), [TokenY] as const))
      .register(
        factoryProvider(TokenY, () => ({ id: 'y' }), [TokenX] as const),
      );

    await expect(builder.build()).rejects.toThrow(/Circular dependency/);
  });
});

describe('прунинг: осиротевшие поддеревья', () => {
  it('выбрасывает узел, единственный потребитель которого заменён', async () => {
    let connected = 0;
    const hooks: string[] = [];

    @Injectable(Pool, [])
    class PgPool implements IPool {
      constructor() {
        connected += 1;
      }

      @OnInit()
      open(): void {
        hooks.push('init:Pool');
      }

      @OnDestroy()
      close(): void {
        hooks.push('destroy:Pool');
      }

      query(): string {
        return 'real';
      }
    }

    @Injectable(Repository, [Pool] as const)
    class PgRepository implements IRepository {
      constructor(private readonly pool: IPool) {}

      find(): string {
        return this.pool.query();
      }
    }

    const container = await new ContainerBuilder({
      overrides: [[Repository, { find: () => 'fake' }]],
    })
      .register(PgPool, PgRepository)
      .build();

    await container.init();
    await container.destroy();

    const { nodes } = await container.toJSON();

    expect(nodes.map((node) => node.id)).toEqual(['Repository']);
    expect(container.pruned).toEqual(['Pool']);
    expect(container.get(Pool)).toBeNull();
    expect(connected).toBe(0);
    expect(hooks).toEqual([]);
  });

  it('оставляет разделяемую зависимость', async () => {
    @Injectable(Pool, [])
    class PgPool implements IPool {
      query(): string {
        return 'real';
      }
    }

    @Injectable(Repository, [Pool] as const)
    class PgRepository implements IRepository {
      constructor(private readonly pool: IPool) {}

      find(): string {
        return this.pool.query();
      }
    }

    @Injectable(Reports, [Pool] as const)
    class ReportsService {
      constructor(private readonly pool: IPool) {}

      build(): string {
        return this.pool.query();
      }
    }

    const container = await new ContainerBuilder({
      overrides: [[Repository, { find: () => 'fake' }]],
    })
      .register(PgPool, PgRepository, ReportsService)
      .build();

    expect(container.pruned).toEqual([]);
    expect(container.getOrThrow(Pool).query()).toBe('real');
  });

  it('прунит цепочку вглубь', async () => {
    const TokenB = makeToken<{ id: string }>('ChainB');
    const TokenC = makeToken<{ id: string }>('ChainC');

    const container = await new ContainerBuilder({
      overrides: [[Repository, { find: () => 'fake' }]],
    })
      .register(factoryProvider(TokenC, () => ({ id: 'c' }), [] as const))
      .register(factoryProvider(TokenB, () => ({ id: 'b' }), [TokenC] as const))
      .register(
        factoryProvider(Repository, () => ({ find: () => 'real' }), [
          TokenB,
        ] as const),
      )
      .build();

    expect([...container.pruned].sort()).toEqual(['ChainB', 'ChainC']);
  });

  it('оставляет членов семейства, нужных только через `.all`', async () => {
    interface ISink {
      readonly scope: string;
    }

    const ISinkFamily = makeTokenFamily<ISink, [scope: string]>('KeptSink');
    const Aggregated = makeToken<readonly ISink[]>('KeptAggregated');

    const container = await new ContainerBuilder({
      overrides: [[Repository, { find: () => 'fake' }]],
    })
      .register(
        familyProvider(ISinkFamily, (scope) =>
          valueProvider(ISinkFamily(scope), { scope }),
        ),
      )
      // Единственный, кто ссылается на членов по имени, — подменяемый узел
      .register(
        factoryProvider(Repository, () => ({ find: () => 'real' }), [
          ISinkFamily('a'),
          ISinkFamily('b'),
        ] as const),
      )
      .register(
        factoryProvider(Aggregated, (sinks: readonly ISink[]) => sinks, [
          ISinkFamily.all,
        ] as const),
      )
      .build();

    expect(container.pruned).toEqual([]);
    expect(container.getOrThrow(Aggregated)).toEqual([
      { scope: 'a' },
      { scope: 'b' },
    ]);
  });

  it('собирает агрегат после прунинга — по оставшимся членам', async () => {
    interface ISink {
      readonly scope: string;
    }

    const ISinkFamily = makeTokenFamily<ISink, [scope: string]>('PrunedSink');
    const Aggregated = makeToken<readonly ISink[]>('PrunedAggregated');

    // Член 'b' нужен только подменяемому узлу и ни одному потребителю
    // `.all`, поэтому удаляется. Если бы агрегат создавался до прунинга,
    // его зависимости указывали бы на удалённого члена, и сборка упала бы
    // на недостающем провайдере вместо агрегата из оставшихся.
    const container = await new ContainerBuilder({
      overrides: [[Repository, { find: () => 'fake' }]],
    })
      .register(
        familyProvider(ISinkFamily, (scope) =>
          valueProvider(ISinkFamily(scope), { scope }),
        ),
      )
      .register(
        factoryProvider(
          Repository,
          (sink: ISink) => ({ find: () => sink.scope }),
          [ISinkFamily('b')] as const,
        ),
      )
      .register(
        factoryProvider(Aggregated, (sinks: readonly ISink[]) => sinks, [
          ISinkFamily.all,
        ] as const),
      )
      .register(
        factoryProvider(
          Reports,
          (sink: ISink) => ({ build: () => sink.scope }),
          [ISinkFamily('a')] as const,
        ),
      )
      .build();

    const { nodes } = await container.toJSON();

    expect(container.pruned).toEqual([]);
    expect(nodes.map((node) => node.id).sort()).toEqual([
      'PrunedAggregated',
      'PrunedSink.all',
      'PrunedSink:a',
      'PrunedSink:b',
      'Reports',
      'Repository',
    ]);
    // Ребро на `.all` разворачивается в рёбра ко всем членам, поэтому
    // оставшийся потребитель агрегата не теряет ни одного из них
    expect(container.getOrThrow(Aggregated)).toEqual([
      { scope: 'b' },
      { scope: 'a' },
    ]);
  });

  it('выбрасывает члена семейства вместе с его единственным потребителем', async () => {
    interface ISink {
      readonly scope: string;
    }

    const ISinkFamily = makeTokenFamily<ISink, [scope: string]>('OrphanSink');

    const container = await new ContainerBuilder({
      overrides: [[Repository, { find: () => 'fake' }]],
    })
      .register(
        familyProvider(ISinkFamily, (scope) =>
          valueProvider(ISinkFamily(scope), { scope }),
        ),
      )
      .register(
        factoryProvider(
          Repository,
          (sink: ISink) => ({ find: () => sink.scope }),
          [ISinkFamily('only')] as const,
        ),
      )
      .build();

    expect(container.pruned).toEqual(['OrphanSink:only']);
  });
});

describe('перечень недостающих зависимостей', () => {
  it('называет все недостающие токены с их потребителями', async () => {
    const ILoggerToken = makeToken<{ log(): void }>('MissingLogger');
    const IClock = makeToken<{ now(): number }>('MissingClock');
    const IUsers = makeToken<{ all(): string[] }>('MissingUsers');

    const builder = new ContainerBuilder()
      .register(
        factoryProvider(Repository, () => ({ find: () => 'real' }), [
          ILoggerToken,
          IClock,
        ] as const),
      )
      .register(
        factoryProvider(Reports, () => ({ build: () => 'r' }), [
          IUsers,
        ] as const),
      );

    const error = await builder.build().catch((error_: Error) => error_);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Unsatisfied dependencies (3)');
    expect((error as Error).message).toContain(
      `- 'MissingLogger' required by 'Repository'`,
    );
    expect((error as Error).message).toContain(
      `- 'MissingClock' required by 'Repository'`,
    );
    expect((error as Error).message).toContain(
      `- 'MissingUsers' required by 'Reports'`,
    );
  });

  it('перечисляет всех потребителей одного недостающего токена', async () => {
    const IClock = makeToken<{ now(): number }>('SharedMissingClock');

    const builder = new ContainerBuilder()
      .register(
        factoryProvider(Repository, () => ({ find: () => 'real' }), [
          IClock,
        ] as const),
      )
      .register(
        factoryProvider(Reports, () => ({ build: () => 'r' }), [
          IClock,
        ] as const),
      );

    await expect(builder.build()).rejects.toThrow(
      `- 'SharedMissingClock' required by 'Repository', 'Reports'`,
    );
  });

  it('токен, похожий на члена семейства, остаётся недостающей зависимостью', async () => {
    const ILogger = makeTokenFamily<{ scope: string }, [scope: string]>(
      'HintFamily',
    );
    const impostor = makeToken<{ scope: string }>('HintFamily:users');

    const builder = new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      )
      .register(
        factoryProvider(Repository, () => ({ find: () => 'real' }), [
          impostor,
        ] as const),
      );

    await expect(builder.build()).rejects.toThrow(
      /Unsatisfied dependencies \(1\):[\s\S]*'HintFamily:users' required by 'Repository'/,
    );
  });
});
