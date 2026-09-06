import { makeToken } from '../common.js';
import { getLifecycleHooks, OnStart } from '../lifecycle/index.js';
import { makeModule } from '../modules/index.js';
import {
  classProvider,
  Component,
  Resource,
  valueProvider,
} from '../providers/index.js';

import { ContainerBuilder } from './container.builder.js';

/** Канал остановки для фазы START: в этих тестах его никто не взводит */
const idleSignal = (): AbortSignal => new AbortController().signal;

describe('BuiltContainer', () => {
  interface IServiceA {
    value(): string;
  }

  interface IServiceB {
    value(): string;
  }

  const TokenA = makeToken<IServiceA>('TokenA');
  const TokenB = makeToken<IServiceB>('TokenB');
  const TokenConfig = makeToken<{ ready: boolean }>('TokenConfig');

  let ServiceA: new () => IServiceA;
  let ServiceB: new (a: IServiceA) => IServiceB;
  let lifecycleLog: string[];

  beforeEach(() => {
    lifecycleLog = [];

    @Component([])
    class ServiceAImpl implements IServiceA {
      constructor() {
        lifecycleLog.push('A:new');
      }

      value(): string {
        return 'a';
      }

      @OnStart()
      async startHook(): Promise<void> {
        lifecycleLog.push('A:start');
      }
    }

    @Component([TokenA] as const)
    class ServiceBImpl implements IServiceB {
      constructor(private readonly a: IServiceA) {
        lifecycleLog.push('B:new');
      }

      value(): string {
        return `B(${this.a.value()})`;
      }

      @OnStart()
      async startHook(): Promise<void> {
        lifecycleLog.push('B:start');
      }
    }

    ServiceA = ServiceAImpl;
    ServiceB = ServiceBImpl;
  });

  const buildContainer = () =>
    new ContainerBuilder()
      .register(classProvider(TokenA, ServiceA))
      .register(classProvider(TokenB, ServiceB))
      .register(valueProvider(TokenConfig, { ready: true }))
      .build();

  it('возвращает зарегистрированные экземпляры через get', async () => {
    const container = buildContainer();
    await container.init();

    expect(container.getOrThrow(TokenA).value()).toBe('a');
    expect(container.getOrThrow(TokenB).value()).toBe('B(a)');
  });

  it('возвращает null из get для незарегистрированного DI-токена', async () => {
    const container = buildContainer();
    await container.init();

    expect(container.get(makeToken('Missing'))).toBeNull();
  });

  it('бросает ошибку в getOrThrow для незарегистрированного DI-токена', async () => {
    const container = buildContainer();
    await container.init();

    expect(() => container.getOrThrow(makeToken('Missing'))).toThrow(
      "Instance for DI token 'Missing' not found",
    );
  });

  it('до init() get бросает ошибку фазы, а не отдаёт null', () => {
    const container = buildContainer();

    expect(() => container.get(TokenA)).toThrow(/phase INIT/);
    expect(() => container.getOrThrow(TokenA)).toThrow(/phase INIT/);
    expect(() => container.getById('TokenA')).toThrow(/phase INIT/);
  });

  it('ошибка фазы отличима от ошибки «DI-токен не зарегистрирован»', () => {
    const container = buildContainer();

    expect(() => container.getOrThrow(makeToken('Missing'))).toThrow(
      /not found/,
    );
    expect(() => container.getOrThrow(TokenA)).not.toThrow(/not found/);
  });

  it('has отвечает про регистрацию и до INIT, не создавая экземпляров', () => {
    const container = buildContainer();

    expect(container.has(TokenA)).toBe(true);
    expect(container.has(makeToken('Missing'))).toBe(false);
    expect(lifecycleLog).toEqual([]);
  });

  it('возвращает зарегистрированные ложные значения из getOrThrow', async () => {
    const ZeroToken = makeToken<number>('Zero');
    const EmptyToken = makeToken<string>('Empty');
    const FalseToken = makeToken<boolean>('False');

    const container = new ContainerBuilder()
      .register(valueProvider(ZeroToken, 0))
      .register(valueProvider(EmptyToken, ''))
      .register(valueProvider(FalseToken, false))
      .build();

    await container.init();

    expect(container.getOrThrow(ZeroToken)).toBe(0);
    expect(container.getOrThrow(EmptyToken)).toBe('');
    expect(container.getOrThrow(FalseToken)).toBe(false);
  });

  it('создаёт экземпляры на init() в топологическом порядке', async () => {
    const container = buildContainer();

    expect(lifecycleLog).toEqual([]);

    await container.init();

    expect(lifecycleLog).toEqual(['A:new', 'B:new']);
  });

  it('выполняет хуки @OnStart в топологическом порядке после INIT', async () => {
    const container = buildContainer();

    await container.init();
    await container.start(idleSignal());

    expect(lifecycleLog).toEqual(['A:new', 'B:new', 'A:start', 'B:start']);
  });

  it('передаёт хуку @OnStart канал остановки', async () => {
    const Token = makeToken<unknown>('Watching');
    let aborted = false;

    @Component([])
    class Watching {
      @OnStart()
      start(signal: AbortSignal): void {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
      }
    }

    const shutdown = new AbortController();
    const container = new ContainerBuilder()
      .register(classProvider(Token, Watching))
      .build();

    await container.init();
    await container.start(shutdown.signal);

    shutdown.abort();

    expect(aborted).toBe(true);
  });

  it('выполняет хуки @OnStart один раз при повторном start()', async () => {
    const container = buildContainer();

    await container.init();
    await container.start(idleSignal());
    await container.start(idleSignal());

    expect(lifecycleLog.filter((entry) => entry.endsWith(':start'))).toEqual([
      'A:start',
      'B:start',
    ]);
  });

  it('проходит, если ни у одного провайдера нет @OnStart', async () => {
    const Token = makeToken<{ ok: boolean }>('NoHooks');

    const container = new ContainerBuilder()
      .register(valueProvider(Token, { ok: true }))
      .build();

    await container.init();

    await expect(container.start(idleSignal())).resolves.toBeUndefined();
  });

  it('пробрасывает ошибку из хука @OnStart', async () => {
    const Token = makeToken('Failing');

    @Component([])
    class Failing {
      @OnStart()
      async startHook(): Promise<void> {
        throw new Error('start failed');
      }
    }

    const container = new ContainerBuilder()
      .register(classProvider(Token, Failing))
      .build();

    await container.init();

    await expect(container.start(idleSignal())).rejects.toThrow('start failed');
  });

  it('освобождает ресурсы в обратном топологическом порядке', async () => {
    const Pool$ = makeToken<Pool>('Pool');

    @Resource([])
    class Pool {
      static async acquire(_signal: AbortSignal): Promise<Pool> {
        lifecycleLog.push('pool:acquire');
        return new Pool();
      }

      release(): void {
        lifecycleLog.push('pool:release');
      }
    }

    @Resource([Pool$] as const)
    class Cache {
      static async acquire(_pool: Pool, _signal: AbortSignal): Promise<Cache> {
        lifecycleLog.push('cache:acquire');
        return new Cache();
      }

      release(): void {
        lifecycleLog.push('cache:release');
      }
    }

    const container = new ContainerBuilder()
      .register(classProvider(Pool$, Pool))
      .register(Cache)
      .build();

    await container.init();
    await container.destroy();

    expect(lifecycleLog).toEqual([
      'pool:acquire',
      'cache:acquire',
      'cache:release',
      'pool:release',
    ]);
  });

  it('повторный destroy() не освобождает ресурс дважды', async () => {
    const Pool$ = makeToken<Pool>('Pool');

    @Resource([])
    class Pool {
      static async acquire(_signal: AbortSignal): Promise<Pool> {
        return new Pool();
      }

      release(): void {
        lifecycleLog.push('pool:release');
      }
    }

    const container = new ContainerBuilder()
      .register(classProvider(Pool$, Pool))
      .build();

    await container.init();
    await container.destroy();
    await container.destroy();

    expect(lifecycleLog).toEqual(['pool:release']);
  });

  it('находит хуки у экземпляра, созданного вне контейнера', () => {
    expect(getLifecycleHooks(new ServiceA()).onStart).toHaveLength(1);
  });

  it('обходит граф зависимостей до создания экземпляров', async () => {
    const container = buildContainer();
    const visited: string[] = [];

    await container.traverse((node) => {
      visited.push(node.id);
    });

    // Обход посещает все узлы
    expect(visited).toHaveLength(3);
    expect(visited).toContain('TokenA');
    expect(visited).toContain('TokenB');
    expect(visited).toContain('TokenConfig');
    // TokenB зависит от TokenA, поэтому TokenA идёт раньше
    expect(visited.indexOf('TokenA')).toBeLessThan(visited.indexOf('TokenB'));
    // И ни одного конструктора при этом не выполнено
    expect(lifecycleLog).toEqual([]);
  });

  it('перебирает узлы синхронно через forEachNode', () => {
    const container = buildContainer();
    const visited: string[] = [];

    container.forEachNode((node) => {
      visited.push(node.id);
    });

    expect(visited).toHaveLength(3);
    expect(visited).toEqual(
      expect.arrayContaining(['TokenA', 'TokenB', 'TokenConfig']),
    );
  });

  it('сериализует метаданные графа в JSON', async () => {
    const ModuleA = makeModule({
      name: 'ModuleA',
      providers: [classProvider(TokenA, ServiceA)],
    });

    const ModuleB = makeModule({
      name: 'ModuleB',
      providers: [classProvider(TokenB, ServiceB)],
      dependsOn: [ModuleA],
    });

    const container = new ContainerBuilder().register(ModuleB).build();

    const json = await container.toJSON();

    expect(json.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'TokenA',
          metadata: { module: 'ModuleA' },
          dependencies: [],
        }),
        expect.objectContaining({
          id: 'TokenB',
          metadata: { module: 'ModuleB' },
          dependencies: ['TokenA'],
        }),
      ]),
    );
  });
});
