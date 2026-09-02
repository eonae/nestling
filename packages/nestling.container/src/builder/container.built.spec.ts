import { makeToken } from '../common';
import { getLifecycleHooks, OnDestroy, OnInit, OnStart } from '../lifecycle';
import { makeModule } from '../modules';
import { classProvider, Injectable, valueProvider } from '../providers';

import { ContainerBuilder } from './container.builder';

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

    @Injectable(TokenA, [])
    class ServiceAImpl implements IServiceA {
      value(): string {
        return 'a';
      }

      @OnInit()
      async initHook(): Promise<void> {
        lifecycleLog.push('A:init');
      }

      @OnStart()
      async startHook(): Promise<void> {
        lifecycleLog.push('A:start');
      }

      @OnDestroy()
      async destroyHook(): Promise<void> {
        lifecycleLog.push('A:destroy');
      }
    }

    @Injectable(TokenB, [TokenA] as const)
    class ServiceBImpl implements IServiceB {
      constructor(private readonly a: IServiceA) {}

      value(): string {
        return `B(${this.a.value()})`;
      }

      @OnInit()
      async initHook(): Promise<void> {
        lifecycleLog.push('B:init');
      }

      @OnStart()
      async startHook(): Promise<void> {
        lifecycleLog.push('B:start');
      }

      @OnDestroy()
      async destroyHook(): Promise<void> {
        lifecycleLog.push('B:destroy');
      }
    }

    ServiceA = ServiceAImpl;
    ServiceB = ServiceBImpl;
  });

  async function buildContainer() {
    return await new ContainerBuilder()
      .register(classProvider(TokenA, ServiceA))
      .register(classProvider(TokenB, ServiceB))
      .register(valueProvider(TokenConfig, { ready: true }))
      .build();
  }

  it('возвращает зарегистрированные экземпляры через get', async () => {
    const container = await buildContainer();

    expect(container.getOrThrow(TokenA).value()).toBe('a');
    expect(container.getOrThrow(TokenB).value()).toBe('B(a)');
  });

  it('возвращает null из get для незарегистрированного токена', async () => {
    const container = await buildContainer();
    const MissingToken = makeToken('Missing');

    expect(container.get(MissingToken)).toBeNull();
  });

  it('бросает ошибку в getOrThrow для незарегистрированного токена', async () => {
    const container = await buildContainer();
    const MissingToken = makeToken('Missing');

    expect(() => container.getOrThrow(MissingToken)).toThrow(
      "Instance for token 'Missing' not found",
    );
  });

  it('возвращает зарегистрированные ложные значения из getOrThrow', async () => {
    const ZeroToken = makeToken<number>('Zero');
    const EmptyToken = makeToken<string>('Empty');
    const FalseToken = makeToken<boolean>('False');

    const container = await new ContainerBuilder()
      .register(valueProvider(ZeroToken, 0))
      .register(valueProvider(EmptyToken, ''))
      .register(valueProvider(FalseToken, false))
      .build();

    expect(container.getOrThrow(ZeroToken)).toBe(0);
    expect(container.getOrThrow(EmptyToken)).toBe('');
    expect(container.getOrThrow(FalseToken)).toBe(false);
  });

  it('выполняет хуки жизненного цикла в правильном порядке', async () => {
    const container = await buildContainer();

    await container.init();
    expect(lifecycleLog).toEqual(['A:init', 'B:init']);

    await container.destroy();
    expect(lifecycleLog).toEqual([
      'A:init',
      'B:init',
      'B:destroy',
      'A:destroy',
    ]);
  });

  it('выполняет хуки @OnStart в топологическом порядке после всех @OnInit', async () => {
    const container = await buildContainer();

    await container.init();
    await container.start();

    expect(lifecycleLog).toEqual(['A:init', 'B:init', 'A:start', 'B:start']);
  });

  it('выполняет хуки @OnStart один раз при повторном start()', async () => {
    const container = await buildContainer();

    await container.init();
    await container.start();
    await container.start();

    expect(lifecycleLog.filter((entry) => entry.endsWith(':start'))).toEqual([
      'A:start',
      'B:start',
    ]);
  });

  it('проходит, если ни у одного провайдера нет @OnStart', async () => {
    const Token = makeToken<{ ok: boolean }>('NoHooks');

    const container = await new ContainerBuilder()
      .register(valueProvider(Token, { ok: true }))
      .build();

    await expect(container.start()).resolves.toBeUndefined();
  });

  it('пробрасывает ошибку из хука @OnStart', async () => {
    const Token = makeToken('Failing');

    @Injectable(Token, [])
    class Failing {
      @OnStart()
      async startHook(): Promise<void> {
        throw new Error('start failed');
      }
    }

    const container = await new ContainerBuilder()
      .register(classProvider(Token, Failing))
      .build();

    await container.init();

    await expect(container.start()).rejects.toThrow('start failed');
  });

  it('находит хуки у экземпляра, созданного вне контейнера', () => {
    const hooks = getLifecycleHooks(new ServiceA());

    expect(hooks.onInit).toHaveLength(1);
    expect(hooks.onDestroy).toHaveLength(1);
  });

  it('обходит граф зависимостей', async () => {
    const container = await buildContainer();
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
    const tokenAIndex = visited.indexOf('TokenA');
    const tokenBIndex = visited.indexOf('TokenB');
    expect(tokenAIndex).toBeLessThan(tokenBIndex);
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

    const container = await new ContainerBuilder().register(ModuleB).build();

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
