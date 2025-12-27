/* eslint-disable @typescript-eslint/no-empty-object-type */

import { makeToken } from '../common';
import { makeModule } from '../modules';
import {
  classProvider,
  factoryProvider,
  Injectable,
  valueProvider,
} from '../providers';

import { ContainerBuilder } from './container.builder';

describe('ContainerBuilder', () => {
  interface IServiceA {
    readonly id: string;
    a(): string;
  }

  interface IServiceB {
    b(): string;
  }

  interface IServiceC {
    c(): string;
  }

  const TokenA = makeToken<IServiceA>('TokenA');
  const TokenB = makeToken<IServiceB>('TokenB');
  const TokenC = makeToken<IServiceC>('TokenC');
  const TokenConfig = makeToken<{ feature: boolean }>('TokenConfig');

  @Injectable(TokenA, [])
  class ServiceA implements IServiceA {
    readonly id = 'A';

    a(): string {
      return 'a';
    }
  }

  @Injectable(TokenB, [TokenA] as const)
  class ServiceB implements IServiceB {
    constructor(private readonly a: IServiceA) {}

    b(): string {
      return `B(${this.a.a()})`;
    }
  }

  @Injectable(TokenC, [TokenA, TokenB] as const)
  class ServiceC implements IServiceC {
    constructor(
      private readonly a: IServiceA,
      private readonly b: IServiceB,
    ) {}

    c(): string {
      return `C(${this.b.b()}, ${this.a.a()})`;
    }
  }

  describe('provider registration', () => {
    it('registers and resolves class provider', async () => {
      const container = await new ContainerBuilder()
        .register(classProvider(TokenA, ServiceA))
        .build();

      const instance = container.get(TokenA);
      expect(instance.id).toBe('A');
      expect(instance.a()).toBe('a');
    });

    it('registers and resolves value provider', async () => {
      const config = { feature: true };

      const container = await new ContainerBuilder()
        .register(valueProvider(TokenConfig, config))
        .build();

      expect(container.get(TokenConfig)).toBe(config);
    });

    it('registers and resolves sync factory provider', async () => {
      const provider = factoryProvider(
        TokenB,
        (a: IServiceA) => ({
          b: () => `factory(${a.a()})`,
        }),
        [TokenA] as const,
      );

      const container = await new ContainerBuilder()
        .register(classProvider(TokenA, ServiceA))
        .register(provider)
        .build();

      const instance = container.get(TokenB);
      expect(instance.b()).toBe('factory(a)');
    });

    it('registers and resolves async factory provider', async () => {
      const asyncProvider = {
        provide: TokenB,
        useFactory: async (a: IServiceA) => {
          await Promise.resolve();
          return {
            b: () => `async(${a.a()})`,
          } satisfies IServiceB;
        },
        deps: [TokenA] as const,
      };

      const container = await new ContainerBuilder()
        .register(classProvider(TokenA, ServiceA))
        .register(asyncProvider)
        .build();

      expect(container.get(TokenB).b()).toBe('async(a)');
    });

    it('registers decorated class without explicit provider definition', async () => {
      const container = await new ContainerBuilder().register(ServiceA).build();

      expect(container.get(TokenA).a()).toBe('a');
    });

    it('supports chaining registers with modules and providers', async () => {
      const ModuleA = makeModule({
        name: 'ModuleA',
        providers: [classProvider(TokenA, ServiceA)],
        exports: [TokenA],
      });

      const container = await new ContainerBuilder()
        .register(ModuleA, classProvider(TokenB, ServiceB))
        .register(classProvider(TokenC, ServiceC))
        .build();

      expect(container.get(TokenC).c()).toBe('C(B(a), a)');
    });

    it('prevents duplicate provider registration', () => {
      const builder = new ContainerBuilder().register(
        valueProvider(TokenA, {
          a: () => 'one',
          id: 'value',
        } satisfies IServiceA),
      );

      expect(() =>
        builder.register(
          valueProvider(TokenA, {
            a: () => 'two',
            id: 'value2',
          } satisfies IServiceA),
        ),
      ).toThrow("Provider for token 'TokenA' is already registered");
    });

    it('prevents registering new items after build', async () => {
      const builder = new ContainerBuilder().register(
        valueProvider(TokenConfig, { feature: true }),
      );

      await builder.build();

      expect(() =>
        builder.register(
          valueProvider(TokenB, { b: () => 'value' } satisfies IServiceB),
        ),
      ).toThrow(
        'Cannot register providers or modules after container is built',
      );
    });
  });

  describe('modules', () => {
    it('loads module with imports', async () => {
      const ModuleA = makeModule({
        name: 'ModuleA',
        providers: [classProvider(TokenA, ServiceA)],
        exports: [TokenA],
      });

      const ModuleB = makeModule({
        name: 'ModuleB',
        providers: [classProvider(TokenB, ServiceB)],
        imports: [ModuleA],
        exports: [TokenB],
      });

      const container = await new ContainerBuilder().register(ModuleB).build();

      expect(container.get(TokenB).b()).toBe('B(a)');
    });

    it('calls providers factory functions', async () => {
      const factoryCalls: string[] = [];

      const ModuleWithFactory = makeModule({
        name: 'ModuleWithFactory',
        providers: () => {
          factoryCalls.push('sync');
          return [valueProvider(TokenConfig, { feature: true })];
        },
        exports: [TokenConfig],
      });

      const container = await new ContainerBuilder()
        .register(ModuleWithFactory)
        .build();

      expect(factoryCalls).toEqual(['sync']);
      expect(container.get(TokenConfig)).toEqual({ feature: true });
    });

    it('supports async provider factories', async () => {
      const ModuleWithAsyncFactory = makeModule({
        name: 'ModuleWithAsyncFactory',
        providers: async () => {
          await Promise.resolve();
          return [classProvider(TokenA, ServiceA)];
        },
        exports: [TokenA],
      });

      const container = await new ContainerBuilder()
        .register(ModuleWithAsyncFactory)
        .build();

      expect(container.get(TokenA).a()).toBe('a');
    });

    it('ignores duplicate module registration', async () => {
      let factoryRuns = 0;

      const ModuleWithFactory = makeModule({
        name: 'DuplicateModule',
        providers: () => {
          factoryRuns += 1;
          return [classProvider(TokenA, ServiceA)];
        },
        exports: [TokenA],
      });

      const container = await new ContainerBuilder()
        .register(ModuleWithFactory)
        .register(ModuleWithFactory)
        .build();

      expect(factoryRuns).toBe(1);
      expect(container.get(TokenA).a()).toBe('a');
    });
  });

  describe('validation and errors', () => {
    it('rejects classes without @Injectable metadata', () => {
      // eslint-disable-next-line @typescript-eslint/no-extraneous-class
      class PlainClass {}

      const builder = new ContainerBuilder();

      expect(() => builder.register(PlainClass)).toThrow(
        'Class PlainClass is missing @Injectable decorator',
      );
    });

    it('fails build when dependency is missing', async () => {
      const builder = new ContainerBuilder().register(
        classProvider(TokenB, ServiceB),
      );

      await expect(builder.build()).rejects.toThrow(
        "Provider for token 'TokenA' not found",
      );
    });

    it('detects circular dependencies', async () => {
      interface IServiceX {}
      interface IServiceY {}
      const TokenX = makeToken<IServiceX>('TokenX');
      const TokenY = makeToken<IServiceY>('TokenY');

      @Injectable(TokenX, [TokenY] as const)
      class ServiceX implements IServiceX {
        constructor(private readonly y: IServiceY) {
          void this.y;
        }
      }

      @Injectable(TokenY, [TokenX] as const)
      class ServiceY implements IServiceY {
        constructor(private readonly x: IServiceX) {
          void this.x;
        }
      }

      const builder = new ContainerBuilder()
        .register(classProvider(TokenX, ServiceX))
        .register(classProvider(TokenY, ServiceY));

      await expect(builder.build()).rejects.toThrow(
        "Circular dependency detected while instantiating 'TokenX'",
      );
    });
  });
});
