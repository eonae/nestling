import { makeToken } from '../common';
import { getLifecycleHooks, OnDestroy, OnInit } from '../lifecycle';
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

  it('returns registered instances via get', async () => {
    const container = await buildContainer();

    expect(container.get(TokenA).value()).toBe('a');
    expect(container.get(TokenB).value()).toBe('B(a)');
  });

  it('throws when instance is missing', async () => {
    const container = await buildContainer();
    const MissingToken = makeToken('Missing');

    expect(() => container.get(MissingToken)).toThrow(
      "Instance for interface 'Missing' is not in the container.",
    );
  });

  it('runs lifecycle hooks in correct order', async () => {
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

  it('supports direct lifecycle hook discovery for external instances', () => {
    const hooks = getLifecycleHooks(new ServiceA());

    expect(hooks.onInit).toHaveLength(1);
    expect(hooks.onDestroy).toHaveLength(1);
  });

  it('traverses dependency graph', async () => {
    const container = await buildContainer();
    const visited: string[] = [];

    await container.traverse((node) => {
      visited.push(node.id);
    });

    // All nodes should be visited
    expect(visited).toHaveLength(3);
    expect(visited).toContain('TokenA');
    expect(visited).toContain('TokenB');
    expect(visited).toContain('TokenConfig');
    // TokenB depends on TokenA, so TokenA must come before TokenB
    const tokenAIndex = visited.indexOf('TokenA');
    const tokenBIndex = visited.indexOf('TokenB');
    expect(tokenAIndex).toBeLessThan(tokenBIndex);
  });

  it('serializes graph metadata to JSON', async () => {
    const ModuleA = makeModule({
      name: 'ModuleA',
      providers: [classProvider(TokenA, ServiceA)],
      exports: [TokenA],
    });

    const ModuleB = makeModule({
      name: 'ModuleB',
      providers: [classProvider(TokenB, ServiceB)],
      imports: [ModuleA],
    });

    const container = await new ContainerBuilder().register(ModuleB).build();

    const json = await container.toJSON();

    expect(json.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'TokenA',
          metadata: { module: 'ModuleA', exported: true },
          dependencies: [],
        }),
        expect.objectContaining({
          id: 'TokenB',
          metadata: { module: 'ModuleB', exported: undefined },
          dependencies: ['TokenA'],
        }),
      ]),
    );
  });
});
