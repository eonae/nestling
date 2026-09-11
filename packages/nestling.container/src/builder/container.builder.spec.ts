/* eslint-disable @typescript-eslint/no-empty-object-type */

import { makeToken } from '../common.js';
import { makeModule } from '../modules/index.js';
import type { ModuleProvider } from '../providers/index.js';
import {
  classProvider,
  Component,
  factoryProvider,
  valueProvider,
} from '../providers/index.js';

import { ContainerBuilder } from './container.builder.js';

/** Опции параметризованного инфраструктурного модуля */
const LoggingOptions$ = makeToken<{ pretty: boolean }>('LoggingOptions');

/**
 * Параметризованный модуль: функция, возвращающая модуль.
 * Каждый вызов создаёт новое значение; на этом строятся тесты идентичности.
 */
const logging = (options: { pretty: boolean }) =>
  makeModule({
    name: 'module:logging',
    providers: [valueProvider(LoggingOptions$, options)],
  });

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

  @Component([])
  class ServiceA implements IServiceA {
    readonly id = 'A';

    a(): string {
      return 'a';
    }
  }

  @Component([TokenA] as const)
  class ServiceB implements IServiceB {
    constructor(private readonly a: IServiceA) {}

    b(): string {
      return `B(${this.a.a()})`;
    }
  }

  @Component([TokenA, TokenB] as const)
  class ServiceC implements IServiceC {
    constructor(
      private readonly a: IServiceA,
      private readonly b: IServiceB,
    ) {}

    c(): string {
      return `C(${this.b.b()}, ${this.a.a()})`;
    }
  }

  describe('регистрация провайдеров', () => {
    it('собирает контейнер синхронно, без ожидания', async () => {
      const container = new ContainerBuilder()
        .register(classProvider(TokenA, ServiceA))
        .build();

      expect(container).not.toBeInstanceOf(Promise);

      await container.init();
      expect(container.getOrThrow(TokenA).a()).toBe('a');
    });

    it('регистрирует провайдер класса и отдаёт экземпляр', async () => {
      const container = new ContainerBuilder()
        .register(classProvider(TokenA, ServiceA))
        .build();

      await container.init();

      const instance = container.getOrThrow(TokenA);
      expect(instance.id).toBe('A');
      expect(instance.a()).toBe('a');
    });

    it('регистрирует провайдер значения и отдаёт значение', async () => {
      const config = { feature: true };

      const container = new ContainerBuilder()
        .register(valueProvider(TokenConfig, config))
        .build();

      await container.init();

      expect(container.get(TokenConfig)).toBe(config);
    });

    it('регистрирует синхронный фабричный провайдер', async () => {
      const provider = factoryProvider(
        TokenB,
        (a: IServiceA) => ({
          b: () => `factory(${a.a()})`,
        }),
        [TokenA] as const,
      );

      const container = new ContainerBuilder()
        .register(classProvider(TokenA, ServiceA))
        .register(provider)
        .build();

      await container.init();

      expect(container.getOrThrow(TokenB).b()).toBe('factory(a)');
    });

    it('отвергает асинхронную фабрику провайдера, называя DI-токен', async () => {
      // Литерал провайдера типом не закрывается: `Module.providers` и
      // `register` принимают значение `unknown`, поэтому асинхронную
      // фабрику ловит только рантайм-проверка сборки
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

      const container = new ContainerBuilder()
        .register(classProvider(TokenA, ServiceA))
        .register(asyncProvider)
        .build();

      await expect(container.init()).rejects.toThrow(
        /Factory of provider 'TokenB' returned a Promise/,
      );
    });

    it('называет место захвата внешнего мира в ошибке фабрики', async () => {
      const asyncProvider = {
        provide: TokenB,
        useFactory: async () => ({ b: () => 'async' }) satisfies IServiceB,
        deps: [] as const,
      };

      const container = new ContainerBuilder().register(asyncProvider).build();

      await expect(container.init()).rejects.toThrow(/@Resource/);
    });

    it('регистрирует класс с декоратором роли под его собственным DI-токеном', async () => {
      const container = new ContainerBuilder().register(ServiceA).build();

      await container.init();

      expect(container.getOrThrow(ServiceA).a()).toBe('a');
    });

    it('принимает модули и провайдеры в цепочке register()', async () => {
      const ModuleA = makeModule({
        name: 'ModuleA',
        providers: [classProvider(TokenA, ServiceA)],
      });

      const container = new ContainerBuilder()
        .register(ModuleA, classProvider(TokenB, ServiceB))
        .register(classProvider(TokenC, ServiceC))
        .build();

      await container.init();

      expect(container.getOrThrow(TokenC).c()).toBe('C(B(a), a)');
    });

    it('отклоняет повторную регистрацию провайдера', () => {
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
      ).toThrow("Provider for DI token 'TokenA' is already registered");
    });

    it('отклоняет регистрацию после build()', async () => {
      const builder = new ContainerBuilder().register(
        valueProvider(TokenConfig, { feature: true }),
      );

      builder.build();

      expect(() =>
        builder.register(
          valueProvider(TokenB, { b: () => 'value' } satisfies IServiceB),
        ),
      ).toThrow(
        'Cannot register providers or modules after container is built',
      );
    });
  });

  describe('модули', () => {
    it('регистрирует модуль вместе с импортами', async () => {
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
      await container.init();

      expect(container.getOrThrow(TokenB).b()).toBe('B(a)');
    });

    it('вызывает фабрики провайдеров модулей', async () => {
      const factoryCalls: string[] = [];

      const ModuleWithFactory = makeModule({
        name: 'ModuleWithFactory',
        providers: () => {
          factoryCalls.push('sync');
          return [valueProvider(TokenConfig, { feature: true })];
        },
      });

      const container = new ContainerBuilder()
        .register(ModuleWithFactory)
        .build();

      expect(factoryCalls).toEqual(['sync']);

      await container.init();
      expect(container.get(TokenConfig)).toEqual({ feature: true });
    });

    it('отвергает асинхронную фабрику провайдеров, называя модуль', () => {
      const ModuleWithAsyncFactory = makeModule({
        name: 'ModuleWithAsyncFactory',
        // Фабрика типизирована синхронной, но `Module.providers` принимает
        // значение `unknown`, поэтому литерал доходит до сборки
        providers: (async () => [
          classProvider(TokenA, ServiceA),
        ]) as unknown as () => ModuleProvider[],
      });

      const builder = new ContainerBuilder().register(ModuleWithAsyncFactory);

      expect(() => builder.build()).toThrow(
        /Providers factory of module 'ModuleWithAsyncFactory' returned a Promise/,
      );
    });

    it('привязывает провайдеры из синхронной фабрики к модулю', async () => {
      const ModuleWithFactory = makeModule({
        name: 'SyncFactoryModule',
        providers: () => [
          classProvider(TokenA, ServiceA),
          valueProvider(TokenConfig, { feature: true }),
        ],
      });

      const container = new ContainerBuilder()
        .register(ModuleWithFactory)
        .build();

      const json = await container.toJSON();

      expect(json.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'TokenA',
            metadata: { module: 'SyncFactoryModule' },
          }),
          expect.objectContaining({
            id: 'TokenConfig',
            metadata: { module: 'SyncFactoryModule' },
          }),
        ]),
      );
    });

    it('пропускает повторную регистрацию того же модуля', async () => {
      let factoryRuns = 0;

      const ModuleWithFactory = makeModule({
        name: 'DuplicateModule',
        providers: () => {
          factoryRuns += 1;
          return [classProvider(TokenA, ServiceA)];
        },
      });

      const container = new ContainerBuilder()
        .register(ModuleWithFactory)
        .register(ModuleWithFactory)
        .build();

      expect(factoryRuns).toBe(1);

      await container.init();
      expect(container.getOrThrow(TokenA).a()).toBe('a');
    });

    it('регистрирует модуль, импортированный по двум путям, один раз', async () => {
      let factoryRuns = 0;

      const Shared = makeModule({
        name: 'SharedModule',
        providers: () => {
          factoryRuns += 1;
          return [classProvider(TokenA, ServiceA)];
        },
      });

      const Left = makeModule({ name: 'LeftModule', dependsOn: [Shared] });
      const Right = makeModule({ name: 'RightModule', dependsOn: [Shared] });

      const container = new ContainerBuilder().register(Left, Right).build();

      expect(factoryRuns).toBe(1);

      await container.init();
      expect(container.getOrThrow(TokenA).id).toBe('A');
    });

    it('завершает обход при цикле в dependsOn', async () => {
      const Left = makeModule({
        name: 'CycleLeft',
        providers: [classProvider(TokenA, ServiceA)],
      });
      const Right = makeModule({ name: 'CycleRight', dependsOn: [Left] });
      Left.dependsOn = [Right];

      const container = new ContainerBuilder().register(Left).build();
      await container.init();

      expect(container.getOrThrow(TokenA).a()).toBe('a');
    });

    it('отклоняет два разных модуля под одним именем', () => {
      const First = makeModule({
        name: 'module:logging',
        providers: [classProvider(TokenA, ServiceA)],
      });
      const Second = makeModule({
        name: 'module:logging',
        providers: [classProvider(TokenB, ServiceB)],
      });

      const builder = new ContainerBuilder();

      expect(() => builder.register(First, Second)).toThrow(
        /Two different modules are named 'module:logging'\..*attribution key.*share one module value.*different names.*duplicated package/s,
      );
    });

    it('отклоняет параметризованный модуль, созданный дважды с равными опциями', () => {
      // Каждый вызов фабрики создаёт новое значение; опции структурно не
      // сравниваются. Значение создают один раз и импортируют его.
      const builder = new ContainerBuilder();

      expect(() =>
        builder.register(logging({ pretty: true }), logging({ pretty: true })),
      ).toThrow("Two different modules are named 'module:logging'");
    });
  });

  describe('проверки и ошибки', () => {
    it('отклоняет класс без декоратора роли, называя позицию', () => {
      // eslint-disable-next-line @typescript-eslint/no-extraneous-class
      class PlainClass {}

      const builder = new ContainerBuilder();

      expect(() => builder.register(PlainClass)).toThrow(
        /Class 'PlainClass' listed in 'providers:' has no role decorator.*factoryProvider or resourceProvider/s,
      );
    });

    it('падает на сборке при отсутствующей зависимости', async () => {
      const builder = new ContainerBuilder().register(
        classProvider(TokenB, ServiceB),
      );

      expect(() => builder.build()).toThrow(
        /Unsatisfied dependencies \(1\):\n {2}- 'TokenA' required by 'TokenB'/,
      );
    });

    it('находит циклические зависимости', async () => {
      interface IServiceX {}
      interface IServiceY {}
      const TokenX = makeToken<IServiceX>('TokenX');
      const TokenY = makeToken<IServiceY>('TokenY');

      @Component([TokenY] as const)
      class ServiceX implements IServiceX {
        constructor(private readonly y: IServiceY) {
          void this.y;
        }
      }

      @Component([TokenX] as const)
      class ServiceY implements IServiceY {
        constructor(private readonly x: IServiceX) {
          void this.x;
        }
      }

      const builder = new ContainerBuilder()
        .register(classProvider(TokenX, ServiceX))
        .register(classProvider(TokenY, ServiceY));

      expect(() => builder.build()).toThrow(
        /Cycles detected in the graph:\nCycle 1:(?: Token[XY] →){2} Token[XY]/,
      );
    });
  });

  describe('подсказки объявлений', () => {
    /** Возвращает текст ошибки сборки — целиком, вместе с подсказками. */
    const buildFailure = (builder: ContainerBuilder): string => {
      try {
        builder.build();
      } catch (error) {
        return (error as Error).message;
      }

      throw new Error('build() did not throw');
    };

    it('печатает подсказку недостающего DI-токена', () => {
      const Bus$ = makeToken<{ publish(): void }>('MessageBus', {
        hint: "add a bus transport to 'transports:'",
      });
      const Relay$ = makeToken<object>('Relay');

      const builder = new ContainerBuilder().register(
        factoryProvider(Relay$, () => ({}), [Bus$] as const),
      );

      expect(buildFailure(builder)).toBe(
        [
          'Unsatisfied dependencies (1):',
          "  - 'MessageBus' required by 'Relay'",
          "    MessageBus: add a bus transport to 'transports:'",
          "Register a provider for each of them (in 'providers:' of a module, or via register()).",
        ].join('\n'),
      );
    });

    it('печатает подсказку потребителя', () => {
      const Bus$ = makeToken<{ publish(): void }>('MessageBus');
      const Relay$ = makeToken<object>('@nestlingjs/outbox relay', {
        hint: 'or remove the outbox plugin',
      });

      const builder = new ContainerBuilder().register(
        factoryProvider(Relay$, () => ({}), [Bus$] as const),
      );

      expect(buildFailure(builder)).toBe(
        [
          'Unsatisfied dependencies (1):',
          "  - 'MessageBus' required by '@nestlingjs/outbox relay'",
          '    @nestlingjs/outbox relay: or remove the outbox plugin',
          "Register a provider for each of them (in 'providers:' of a module, or via register()).",
        ].join('\n'),
      );
    });

    it('печатает обе подсказки по строке на DI-токен', () => {
      const Bus$ = makeToken<{ publish(): void }>('MessageBus', {
        hint: "add a bus transport to 'transports:'",
      });
      const Relay$ = makeToken<object>('@nestlingjs/outbox relay', {
        hint: 'or remove the outbox plugin',
      });

      const builder = new ContainerBuilder().register(
        factoryProvider(Relay$, () => ({}), [Bus$] as const),
      );

      expect(buildFailure(builder)).toBe(
        [
          'Unsatisfied dependencies (1):',
          "  - 'MessageBus' required by '@nestlingjs/outbox relay'",
          "    MessageBus: add a bus transport to 'transports:'",
          '    @nestlingjs/outbox relay: or remove the outbox plugin',
          "Register a provider for each of them (in 'providers:' of a module, or via register()).",
        ].join('\n'),
      );
    });

    it('не меняет текст, когда подсказок нет', () => {
      const builder = new ContainerBuilder().register(
        classProvider(TokenB, ServiceB),
      );

      expect(buildFailure(builder)).toBe(
        [
          'Unsatisfied dependencies (1):',
          "  - 'TokenA' required by 'TokenB'",
          "Register a provider for each of them (in 'providers:' of a module, or via register()).",
        ].join('\n'),
      );
    });

    it('перечисляет три дыры, печатая подсказку у своего DI-токена', () => {
      const First$ = makeToken<object>('First', { hint: 'declare it' });
      const Second$ = makeToken<object>('Second');
      const Third$ = makeToken<object>('Third');
      const Consumer$ = makeToken<object>('Consumer');

      const builder = new ContainerBuilder().register(
        factoryProvider(Consumer$, () => ({}), [
          First$,
          Second$,
          Third$,
        ] as const),
      );

      expect(buildFailure(builder)).toBe(
        [
          'Unsatisfied dependencies (3):',
          "  - 'First' required by 'Consumer'",
          '    First: declare it',
          "  - 'Second' required by 'Consumer'",
          "  - 'Third' required by 'Consumer'",
          "Register a provider for each of them (in 'providers:' of a module, or via register()).",
        ].join('\n'),
      );
    });

    it('не считает подсказку частью идентичности DI-токена', () => {
      const first = makeToken<object>('Same', { hint: 'one' });
      const second = makeToken<object>('Same', { hint: 'two' });

      expect(first).not.toBe(second);
      expect(Object.isFrozen(first)).toBe(true);
    });
  });
});
