/* eslint-disable @typescript-eslint/no-empty-function */

/**
 * Ресурсы: захват на INIT в топологическом порядке, откат при провале и
 * освобождение в обратном порядке.
 */

import { makeToken } from '../common.js';
import { Component, Resource, resourceProvider } from '../providers/index.js';

import { ContainerBuilder } from './container.builder.js';

describe('ресурсы', () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
  });

  it('захватывает класс-ресурс вызовом static acquire', async () => {
    @Resource([])
    class Database {
      static async acquire(signal: AbortSignal): Promise<Database> {
        calls.push(`db:acquire(aborted=${signal.aborted})`);
        return new Database();
      }

      release(): void {
        calls.push('db:release');
      }
    }

    const container = new ContainerBuilder().register(Database).build();

    expect(calls).toEqual([]);

    await container.init();

    expect(calls).toEqual(['db:acquire(aborted=false)']);
    expect(container.getOrThrow(Database)).toBeInstanceOf(Database);
  });

  it('передаёт зависимости в acquire по порядку, сигнал — последним', async () => {
    const Dsn$ = makeToken<string>('Dsn');

    const container = new ContainerBuilder()
      .register({ provide: Dsn$, useValue: 'postgres://db' })
      .register(
        resourceProvider(makeToken<{ dsn: string }>('Pool'), {
          deps: [Dsn$] as const,
          acquire: (dsn, signal) => {
            calls.push(
              `pool:acquire(${dsn},${String(signal instanceof AbortSignal)})`,
            );
            return { dsn };
          },
          release: () => void calls.push('pool:release'),
        }),
      )
      .build();

    await container.init();

    expect(calls).toEqual(['pool:acquire(postgres://db,true)']);
  });

  it('захватывает в топологическом порядке: зависимость раньше зависимого', async () => {
    @Resource([])
    class Database {
      static async acquire(_signal: AbortSignal): Promise<Database> {
        calls.push('db:acquire');
        return new Database();
      }

      release(): void {}
    }

    @Resource([Database] as const)
    class Cache {
      static async acquire(
        _db: Database,
        _signal: AbortSignal,
      ): Promise<Cache> {
        calls.push('cache:acquire');
        return new Cache();
      }

      release(): void {}
    }

    const container = new ContainerBuilder().register(Database, Cache).build();

    await container.init();

    expect(calls).toEqual(['db:acquire', 'cache:acquire']);
  });

  it('потребитель ресурса получает захваченное значение в конструктор', async () => {
    @Resource([])
    class Database {
      readonly ready = true;

      static async acquire(_signal: AbortSignal): Promise<Database> {
        calls.push('db:acquire');
        return new Database();
      }

      release(): void {}
    }

    @Component([Database] as const)
    class UserService {
      constructor(readonly db: Database) {
        calls.push(`users:new(ready=${String(db.ready)})`);
      }
    }

    const container = new ContainerBuilder()
      .register(Database, UserService)
      .build();

    await container.init();

    expect(calls).toEqual(['db:acquire', 'users:new(ready=true)']);
  });

  it('захватывает ресурс без потребителей наравне с прочими узлами', async () => {
    @Resource([])
    class Lonely {
      static async acquire(_signal: AbortSignal): Promise<Lonely> {
        calls.push('lonely:acquire');
        return new Lonely();
      }

      release(): void {}
    }

    const container = new ContainerBuilder().register(Lonely).build();
    await container.init();

    expect(calls).toEqual(['lonely:acquire']);
  });

  it('освобождает захваченное в обратном порядке при провале захвата', async () => {
    @Resource([])
    class Database {
      static async acquire(_signal: AbortSignal): Promise<Database> {
        calls.push('db:acquire');
        return new Database();
      }

      release(): void {
        calls.push('db:release');
      }
    }

    @Resource([Database] as const)
    class Cache {
      static async acquire(
        _db: Database,
        _signal: AbortSignal,
      ): Promise<Cache> {
        calls.push('cache:acquire');
        throw new Error('cache is down');
      }

      release(): void {
        calls.push('cache:release');
      }
    }

    const container = new ContainerBuilder().register(Database, Cache).build();

    await expect(container.init()).rejects.toThrow('cache is down');

    expect(calls).toEqual(['db:acquire', 'cache:acquire', 'db:release']);
  });

  it('взводит сигнал acquire перед откатом', async () => {
    let seen: AbortSignal | undefined;

    @Resource([])
    class Slow {
      static async acquire(signal: AbortSignal): Promise<Slow> {
        seen = signal;
        return new Slow();
      }

      release(): void {}
    }

    @Resource([Slow] as const)
    class Broken {
      static async acquire(_slow: Slow, _signal: AbortSignal): Promise<Broken> {
        throw new Error('nope');
      }

      release(): void {}
    }

    const container = new ContainerBuilder().register(Slow, Broken).build();

    await expect(container.init()).rejects.toThrow('nope');

    expect(seen?.aborted).toBe(true);
  });

  it('ошибку release прикладывает к причине, не подменяя её', async () => {
    @Resource([])
    class Database {
      static async acquire(_signal: AbortSignal): Promise<Database> {
        return new Database();
      }

      release(): void {
        throw new Error('release failed');
      }
    }

    @Resource([Database] as const)
    class Cache {
      static async acquire(
        _db: Database,
        _signal: AbortSignal,
      ): Promise<Cache> {
        throw new Error('cache is down');
      }

      release(): void {}
    }

    const container = new ContainerBuilder().register(Database, Cache).build();

    const error = await container.init().catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('cache is down');
    expect((error as Error).cause).toMatchObject({
      message: 'release failed',
    });
  });

  it('ошибка конструктора компонента освобождает захваченное', async () => {
    @Resource([])
    class Database {
      static async acquire(_signal: AbortSignal): Promise<Database> {
        calls.push('db:acquire');
        return new Database();
      }

      release(): void {
        calls.push('db:release');
      }
    }

    @Component([Database] as const)
    class Broken {
      constructor(_db: Database) {
        throw new Error('constructor failed');
      }
    }

    const container = new ContainerBuilder().register(Database, Broken).build();

    await expect(container.init()).rejects.toThrow('constructor failed');

    expect(calls).toEqual(['db:acquire', 'db:release']);
  });

  it('захватывает узел ровно один раз за запуск', async () => {
    @Resource([])
    class Database {
      static async acquire(_signal: AbortSignal): Promise<Database> {
        calls.push('db:acquire');
        return new Database();
      }

      release(): void {}
    }

    const container = new ContainerBuilder().register(Database).build();

    await container.init();
    await container.init();

    expect(calls).toEqual(['db:acquire']);
  });

  it('рецепт семейства может отдавать ресурс', async () => {
    const Pool$ = makeToken<{ name: string }>('Pool');

    const container = new ContainerBuilder()
      .register(
        resourceProvider(Pool$, {
          deps: [] as const,
          acquire: () => {
            calls.push('pool:acquire');
            return { name: 'default' };
          },
          release: () => void calls.push('pool:release'),
        }),
      )
      .build();

    await container.init();
    await container.destroy();

    expect(calls).toEqual(['pool:acquire', 'pool:release']);
  });

  it('конструктор ресурса контейнер не вызывает', async () => {
    @Resource([])
    class Database {
      static async acquire(_signal: AbortSignal): Promise<Database> {
        return new Database('from acquire');
      }

      constructor(readonly origin: string) {
        calls.push(`db:new(${origin})`);
      }

      release(): void {}
    }

    const container = new ContainerBuilder().register(Database).build();
    await container.init();

    expect(calls).toEqual(['db:new(from acquire)']);
    expect(container.getOrThrow(Database).origin).toBe('from acquire');
  });
});
