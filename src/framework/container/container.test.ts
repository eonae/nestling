import { Injectable } from '../container.providers/injectable.decorator';
import { makeToken } from '../common';
import { classProvider, valueProvider, factoryProvider } from '../provider';
import { OnDestroy, OnInit, getLifecycleHooks } from '../lifecycle';
import { Module } from '../container.providers/module.decorator';
import { ContainerBuilder } from './container.builder';

describe('Container', () => {
  interface A {
    a(): string;
  }

  interface B {
    b(): string;
  }

  interface C {
    c(): string;
  }

  const A = makeToken<A>('A');
  const B = makeToken<B>('B');
  const C = makeToken<C>('C');

  @Injectable(A, [])
  class AImpl implements A {
    a = () => 'a';
  }

  @Injectable(B, [A])
  class BImpl implements B {
    #a: A;

    constructor(a: A) {
      this.#a = a;
    }

    b = () => `B(${this.#a.a()})`;
  }

  @Injectable(C, [A, B])
  class CImpl implements C {
    #a: A;
    #b: B;

    constructor(a: A, b: B) {
      this.#a = a;
      this.#b = b;
    }

    c = () => `C(${this.#b.b()}, ${this.#a.a()})`;
  }

  describe('provider registration', () => {
    it('can register and get ClassProvider', async () => {
      const container = await new ContainerBuilder()
        .register(classProvider(A, AImpl))
        .build();

      const instance = container.get(A);
      expect(instance.a()).toBe('a');
    });

    it('can register and get ValueProvider', async () => {
      const value = { a: () => 'value' };
      const container = await new ContainerBuilder()
        .register(valueProvider(A, value))
        .build();

      const instance = container.get(A);
      expect(instance).toBe(value);
      expect(instance.a()).toBe('value');
    });

    it('can register and get sync FactoryProvider', async () => {
      const factory = (a: A) => ({ b: () => `SyncB(${a.a()})` });
      
      const container = await new ContainerBuilder()
        .register(classProvider(A, AImpl))
        .register(factoryProvider(B, factory, [A]))
        .build();

      const bInstance = container.get(B);
      expect(bInstance.b()).toBe('SyncB(a)');
    });

    it('can register and get async FactoryProvider', async () => {
      const asyncFactory = async (a: A) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { b: () => `AsyncB(${a.a()})` };
      };

      const container = await new ContainerBuilder()
        .register(classProvider(A, AImpl))
        .register({ provide: B, useFactory: asyncFactory, deps: [A] })
        .build();

      const bInstance = container.get(B);
      expect(bInstance.b()).toBe('AsyncB(a)');
    });

    it('supports fluent interface for multiple providers', async () => {
      const container = await new ContainerBuilder()
        .register(classProvider(A, AImpl))
        .register(classProvider(B, BImpl))
        .register(classProvider(C, CImpl))
        .build();

      const cInstance = container.get(C);
      expect(cInstance.c()).toBe('C(B(a), a)');
    });

    it('fails if provider is already registered', () => {
      const builder = new ContainerBuilder()
        .register(valueProvider(A, { a: () => 'a1' }));

      expect(() => builder.register(valueProvider(A, { a: () => 'a2' }))).toThrow(
        /Provider for token 'A' is already registered/
      );
    });

    it('fails if trying to register after build', async () => {
      const builder = new ContainerBuilder()
        .register(valueProvider(A, { a: () => 'a' }));

      await builder.build();

      expect(() => builder.register(valueProvider(B, { b: () => 'b' }))).toThrow(
        /Cannot register providers or modules after container is built/
      );
    });

    it('can mix providers and modules in single register call', async () => {
      @Module({
        deps: [],
        providers: [classProvider(A, AImpl)],
        exports: [A]
      })
      class AModule {}

      const container = await new ContainerBuilder()
        .register(
          AModule,
          classProvider(B, BImpl),
          valueProvider(C, { c: () => 'mixed' })
        )
        .build();

      const bInstance = container.get(B);
      const cInstance = container.get(C);
      
      expect(bInstance.b()).toBe('B(a)');
      expect(cInstance.c()).toBe('mixed');
    });

    it('supports fluent interface with mixed items', async () => {
      @Module({
        deps: [],
        providers: [classProvider(A, AImpl)],
        exports: [A]
      })
      class AModule {}

      const container = await new ContainerBuilder()
        .register(AModule)
        .register(classProvider(B, BImpl))
        .register({ provide: C, useFactory: (a: A, b: B) => ({ c: () => `C(${a.a()}, ${b.b()})` }), deps: [A, B] })
        .build();

      const cInstance = container.get(C);
      expect(cInstance.c()).toBe('C(a, B(a))');
    });
  });

  describe('validation', () => {
    it('validates module is decorated with @Module', () => {
      class NotAModule {}

      const container = new ContainerBuilder();
      expect(() => container.register(NotAModule)).toThrow(
        'Class NotAModule is not decorated with @Injectable or @Module provider'
      );
    });

    it('validates @Module decorator type checking', () => {
      // This test verifies that TypeScript will catch type mismatches
      // between constructor parameters and deps array
      
      // Valid usage - constructor matches deps
      @Module({
        providers: [],
        exports: [],
        deps: [A],
      })
      class ValidModule {
        constructor(private a: A) {}
      }

      // This should compile without errors
      expect(ValidModule).toBeDefined();

      // Valid usage - no constructor parameters, no deps
      @Module({
        deps: [],
        providers: [],
        exports: []
      })
      class NoDepsModule {
        constructor() {}
      }

      expect(NoDepsModule).toBeDefined();

      // Invalid usage - this should cause TypeScript error
      // but we can't test it directly in runtime
      // The TypeScript compiler will catch:
      // - Missing deps when constructor has parameters
      // - Wrong types in deps array
      // - Wrong order of dependencies
    });

    it('validates @Module with multiple dependencies', () => {
      // Test with multiple dependencies
      @Module({
        providers: [],
        exports: [],
        deps: [A, B],
      })
      class MultiDepsModule {
        constructor(private a: A, private b: B) {}
      }

      expect(MultiDepsModule).toBeDefined();
    });

    it('validates @Module dependency injection works correctly', async () => {
      // Test that module dependencies are actually injected
      @Module({
        providers: [],
        exports: [],
        deps: [A]
      })
      class TestModule {
        constructor(private a: A) {}
        
        getA(): A {
          return this.a;
        }
      }

      const container = await new ContainerBuilder()
        .register(classProvider(A, AImpl), TestModule)
        .build();

      const moduleInstance = container.get(TestModule);
      expect(moduleInstance.getA()).toBeDefined();
      expect(moduleInstance.getA().a()).toBe('a');
    });
  });

  describe('lifecycle decorators', () => {
    it('detects OnInit decorator', () => {
      class TestOnInit {
        @OnInit()
        initMethod(): void {
          console.log('init');
        }
      }

      class TestWithoutOnInit {
        someMethod(): void {
          console.log('method');
        }
      }

      const hooks1 = getLifecycleHooks(new TestOnInit());
      const hooks2 = getLifecycleHooks(new TestWithoutOnInit());

      expect(hooks1.onInit).toHaveLength(1);
      expect(hooks1.onDestroy).toHaveLength(0);
      expect(hooks2.onInit).toHaveLength(0);
      expect(hooks2.onDestroy).toHaveLength(0);
    });

    it('detects OnDestroy decorator', () => {
      class TestOnDestroy {
        @OnDestroy()
        destroyMethod(): void {
          console.log('destroy');
        }
      }

      class TestWithoutOnDestroy {
        someMethod(): void {
          console.log('method');
        }
      }

      const hooks1 = getLifecycleHooks(new TestOnDestroy());
      const hooks2 = getLifecycleHooks(new TestWithoutOnDestroy());

      expect(hooks1.onInit).toHaveLength(0);
      expect(hooks1.onDestroy).toHaveLength(1);
      expect(hooks2.onInit).toHaveLength(0);
      expect(hooks2.onDestroy).toHaveLength(0);
    });

    it('detects both lifecycle decorators', () => {
      class TestBoth {
        @OnInit()
        initMethod(): void {
          console.log('init');
        }

        @OnDestroy()
        destroyMethod(): void {
          console.log('destroy');
        }
      }

      const hooks = getLifecycleHooks(new TestBoth());
      expect(hooks.onInit).toHaveLength(1);
      expect(hooks.onDestroy).toHaveLength(1);
    });

    it('can have multiple lifecycle methods', () => {
      class TestMultiple {
        @OnInit()
        init1(): void {
          console.log('init1');
        }

        @OnInit()
        init2(): void {
          console.log('init2');
        }

        @OnDestroy()
        destroy1(): void {
          console.log('destroy1');
        }

        @OnDestroy()
        destroy2(): void {
          console.log('destroy2');
        }
      }

      const hooks = getLifecycleHooks(new TestMultiple());
      expect(hooks.onInit).toHaveLength(2);
      expect(hooks.onDestroy).toHaveLength(2);
    });
  });

  describe('lifecycle hooks', () => {
    it('can initialize modules with OnInit decorators', async () => {
      let initOrder: string[] = [];
      
      @Module({
        deps: [],
        providers: [classProvider(A, AImpl)],
        exports: [A]
      })
      class Module1 {
        @OnInit()
        async initialize() {
          initOrder.push('Module1');
        }
      }
      
      @Module({
        deps: [],
        providers: [classProvider(B, BImpl)],
        exports: [B]
      })
      class Module2 {
        @OnInit()
        async initialize() {
          initOrder.push('Module2');
        }
      }

      const container = await new ContainerBuilder()
        .register(Module1, Module2)
        .build();

      await container.init();
      
      expect(initOrder).toEqual(['Module1', 'Module2']);
    });

    it('can destroy modules with OnDestroy decorators in reverse order', async () => {
      let destroyOrder: string[] = [];
      
      @Module({
        deps: [],
        providers: [classProvider(A, AImpl)],
        exports: [A]
      })
      class Module1 {
        @OnDestroy()
        async cleanup() {
          destroyOrder.push('Module1');
        }
      }
      
      @Module({
        deps: [],
        providers: [classProvider(B, BImpl)],
        exports: [B]
      })
      class Module2 {
        @OnDestroy()
        async cleanup() {
          destroyOrder.push('Module2');
        }
      }

      const container = await new ContainerBuilder()
        .register(Module1, Module2)
        .build();

      await container.destroy();
      
      expect(destroyOrder).toEqual(['Module2', 'Module1']);
    });

    it('can handle mixed lifecycle hooks', async () => {
      let lifecycleOrder: string[] = [];
      
      @Module({
        deps: [],
        providers: [classProvider(A, AImpl)],
        exports: [A]
      })
      class Module1 {
        @OnInit()
        async initialize() {
          lifecycleOrder.push('Module1-init');
        }
        
        @OnDestroy()
        async cleanup() {
          lifecycleOrder.push('Module1-destroy');
        }
      }
      
      @Module({
        deps: [],
        providers: [classProvider(B, BImpl)],
        exports: [B]
      })
      class Module2 {
        @OnInit()
        async initialize() {
          lifecycleOrder.push('Module2-init');
        }
      }

      const container = await new ContainerBuilder()
        .register(Module1, Module2)
        .build();

      await container.init();
      await container.destroy();
      
      expect(lifecycleOrder).toEqual(['Module1-init', 'Module2-init', 'Module1-destroy']);
    });

    it('can initialize Injectable classes with OnInit decorators', async () => {
      let initOrder: string[] = [];
      
      @Injectable(A, [])
      class AWithInit implements A {
        @OnInit()
        async initialize() {
          initOrder.push('A-init');
        }

        a = () => 'a';
      }

      @Injectable(B, [A])
      class BWithInit implements B {
        #a: A;

        constructor(a: A) {
          this.#a = a;
        }

        @OnInit()
        async initialize() {
          initOrder.push('B-init');
        }

        b = () => `B(${this.#a.a()})`;
      }

      const container = await new ContainerBuilder()
        .register(classProvider(A, AWithInit))
        .register(classProvider(B, BWithInit))
        .build();

      await container.init();
      
      expect(initOrder).toEqual(['A-init', 'B-init']);
    });
  });

  describe('external instances', () => {
    it('can work with external instances as ValueProvider', async () => {
      interface ExternalService {
        getValue(): string;
      }

      const ExternalService = makeToken<ExternalService>('ExternalService');

      @Injectable(B, [ExternalService])
      class BWithExternal implements B {
        #external: ExternalService;

        constructor(external: ExternalService) {
          this.#external = external;
        }

        b = () => this.#external.getValue();
      }

      const externalInstance = { getValue: () => 'external value' };
      
      const container = await new ContainerBuilder()
        .register(valueProvider(ExternalService, externalInstance))
        .register(classProvider(B, BWithExternal))
        .build();

      const bInstance = container.get(B);
      expect(bInstance.b()).toBe('external value');
    });

    it('can mix external instances with other providers', async () => {
      interface Config {
        apiUrl: string;
      }

      const Config = makeToken<Config>('Config');

      @Injectable(C, [A, Config])
      class CWithConfig implements C {
        #a: A;
        #config: Config;

        constructor(a: A, config: Config) {
          this.#a = a;
          this.#config = config;
        }

        c = () => `C(${this.#a.a()}, ${this.#config.apiUrl})`;
      }

      const configInstance = { apiUrl: 'https://api.com' };

      const container = await new ContainerBuilder()
        .register(classProvider(A, AImpl))
        .register(valueProvider(Config, configInstance))
        .register(classProvider(C, CWithConfig))
        .build();

      const cInstance = container.get(C);
      expect(cInstance.c()).toBe('C(a, https://api.com)');
    });
  });

  describe('module system', () => {
    it('can load simple module', async () => {
      @Module({
        deps: [],
        providers: [classProvider(A, AImpl)],
        exports: [A]
      })
      class TestModule {}

      const container = await new ContainerBuilder()
        .register(TestModule)
        .build();

      const instance = container.get(A);
      expect(instance.a()).toBe('a');
    });

    it('can load module with imports', async () => {
      @Module({
        deps: [],
        providers: [classProvider(A, AImpl)],
        exports: [A]
      })
      class AModule {}

      @Module({
        deps: [],
        providers: [classProvider(B, BImpl)],
        exports: [B],
        imports: [AModule]
      })
      class BModule {}

      const container = await new ContainerBuilder()
        .register(BModule)
        .build();

      const bInstance = container.get(B);
      expect(bInstance.b()).toBe('B(a)');
    });


    it('can load module with factory provider', async () => {
      @Module({
        deps: [],
        providers: [
          classProvider(A, AImpl),
          factoryProvider(B, (a: A) => ({ b: () => `FactoryB(${a.a()})` }), [A])
        ],
        exports: [B]
      })
      class FactoryModule {}

      const container = await new ContainerBuilder()
        .register(FactoryModule)
        .build();

      const bInstance = container.get(B);
      expect(bInstance.b()).toBe('FactoryB(a)');
    });

    it('can load module with constructor dependencies', async () => {
      @Module({
        deps: [],
        providers: [classProvider(A, AImpl)],
        exports: [A]
      })
      class AModule {}

      @Module({
        providers: [classProvider(B, BImpl)],
        exports: [B],
        imports: [AModule],
        deps: [A] // Module depends on A
      })
      class BModule {
        constructor(private a: A) {}
        
        @OnInit()
        init() {
          console.log('BModule initialized with A:', this.a.a());
        }
      }

      const container = await new ContainerBuilder()
        .register(BModule)
        .build();

      const bInstance = container.get(B);
      expect(bInstance.b()).toBe('B(a)');
    });

    it('can register Injectable class with dependencies', async () => {
      @Injectable([A])
      class InjectableService {
        constructor(private a: A) {}
        
        getValue(): string {
          return `InjectableService(${this.a.a()})`;
        }
      }

      const container = await new ContainerBuilder()
        .register(classProvider(A, AImpl), InjectableService)
        .build();

      const service = container.get(InjectableService);
      expect(service.getValue()).toBe('InjectableService(a)');
    });

  });

  describe('dependency resolution', () => {
    it('can instantiate complex dependency graph', async () => {
      const container = await new ContainerBuilder()
        .register(classProvider(A, AImpl))
        .register(classProvider(B, BImpl))
        .register(classProvider(C, CImpl))
        .build();

      const cInstance = container.get(C);
      expect(cInstance.c()).toBe('C(B(a), a)');
    });


    it('returns same instance on multiple calls (singleton)', async () => {
      const container = await new ContainerBuilder()
        .register(classProvider(A, AImpl))
        .build();

      const instance1 = container.get(A);
      const instance2 = container.get(A);

      expect(instance1).toBe(instance2);
    });

    it('fails if dependency is missing', async () => {
      const container = new ContainerBuilder()
        .register(classProvider(B, BImpl));

      await expect(container.build()).rejects.toThrow(
        /assertion error: dependency ID missing A/
      );
    });

    it('fails if instance is not registered', async () => {
      const container = await new ContainerBuilder().build();

      expect(() => container.get(A)).toThrow(
        /Instance for interface 'A' is not in the container/
      );
    });
  });

  describe('circular dependencies', () => {
    it('detects circular dependencies', async () => {
      @Injectable(A, [C])
      class ACircular implements A {
        #c: C;

        constructor(c: C) {
          this.#c = c;
        }

        a = () => `A(${this.#c.c()})`;
      }

      const container = new ContainerBuilder()
        .register(classProvider(A, ACircular))
        .register(classProvider(B, BImpl))
        .register(classProvider(C, CImpl));

      await expect(container.build()).rejects.toThrow(
        /Circular dependency detected between interfaces/
      );
    });
  });

  describe('complex scenarios', () => {
    it('can handle complex dependency graph', async () => {
      interface D {
        d(): string;
      }

      interface E {
        e(): string;
      }

      const D = makeToken<D>('D');
      const E = makeToken<E>('E');

      @Injectable(D, [A, B])
      class DImpl implements D {
        #a: A;
        #b: B;

        constructor(a: A, b: B) {
          this.#a = a;
          this.#b = b;
        }

        d = () => `D(${this.#a.a()}, ${this.#b.b()})`;
      }

      @Injectable(E, [C, D])
      class EImpl implements E {
        #c: C;
        #d: D;

        constructor(c: C, d: D) {
          this.#c = c;
          this.#d = d;
        }

        e = () => `E(${this.#c.c()}, ${this.#d.d()})`;
      }

      const container = await new ContainerBuilder()
        .register(classProvider(A, AImpl))
        .register(classProvider(B, BImpl))
        .register(classProvider(C, CImpl))
        .register(classProvider(D, DImpl))
        .register(classProvider(E, EImpl))
        .build();

      const eInstance = container.get(E);
      expect(eInstance.e()).toBe('E(C(B(a), a), D(a, B(a)))');
    });
  });
});