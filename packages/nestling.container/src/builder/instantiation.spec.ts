/* eslint-disable @typescript-eslint/no-empty-function */

/**
 * Экземпляры создаются на INIT: `build()` проверяет граф и не выполняет ни
 * одного конструктора, а роль класса сверяется с позицией.
 */

import { makeToken } from '../common.js';
import { makeModule } from '../modules/index.js';
import {
  Component,
  factoryProvider,
  Handler,
  Resource,
  valueProvider,
} from '../providers/index.js';

import { ContainerBuilder } from './container.builder.js';

describe('создание экземпляров на INIT', () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
  });

  it('build() не выполняет ни одного конструктора', () => {
    @Component([])
    class Noisy {
      constructor() {
        calls.push('noisy');
      }
    }

    new ContainerBuilder().register(Noisy).build();

    expect(calls).toEqual([]);
  });

  it('build() не вызывает фабрику провайдера', () => {
    const Token$ = makeToken<string>('Made');

    new ContainerBuilder()
      .register(
        factoryProvider(
          Token$,
          () => {
            calls.push('factory');
            return 'value';
          },
          [] as const,
        ),
      )
      .build();

    expect(calls).toEqual([]);
  });

  it('цикл виден на сборке, и ни один конструктор не выполнен', () => {
    const TokenX = makeToken<unknown>('TokenX');
    const TokenY = makeToken<unknown>('TokenY');

    @Component([TokenY] as const)
    class ServiceX {
      constructor(_y: unknown) {
        calls.push('x');
      }
    }

    @Component([TokenX] as const)
    class ServiceY {
      constructor(_x: unknown) {
        calls.push('y');
      }
    }

    const builder = new ContainerBuilder()
      .register({ provide: TokenX, useClass: ServiceX, deps: [TokenY] })
      .register({ provide: TokenY, useClass: ServiceY, deps: [TokenX] });

    expect(() => builder.build()).toThrow(/Cycles detected in the graph/);
    expect(calls).toEqual([]);
  });

  it('перечисляет все недостающие DI-токены одной ошибкой', () => {
    const First$ = makeToken<unknown>('First');
    const Second$ = makeToken<unknown>('Second');
    const Third$ = makeToken<unknown>('Third');

    @Component([First$, Second$, Third$] as const)
    class Consumer {
      readonly deps: unknown[];

      constructor(a: unknown, b: unknown, c: unknown) {
        this.deps = [a, b, c];
      }
    }

    const builder = new ContainerBuilder().register(Consumer);

    expect(() => builder.build()).toThrow(/Unsatisfied dependencies \(3\)/);
  });

  it('init() создаёт каждый узел ровно один раз', async () => {
    @Component([])
    class Once {
      constructor() {
        calls.push('once');
      }
    }

    const container = new ContainerBuilder().register(Once).build();

    await container.init();
    await container.init();

    expect(calls).toEqual(['once']);
  });

  it('ошибка конструктора роняет init()', async () => {
    @Component([])
    class Broken {
      constructor() {
        throw new Error('constructor failed');
      }
    }

    const container = new ContainerBuilder().register(Broken).build();

    await expect(container.init()).rejects.toThrow('constructor failed');
  });

  it('обход графа работает до INIT', async () => {
    const Config$ = makeToken<{ ok: boolean }>('Config');

    @Component([Config$] as const)
    class Service {
      constructor(_config: { ok: boolean }) {
        calls.push('service');
      }
    }

    const container = new ContainerBuilder()
      .register(valueProvider(Config$, { ok: true }), Service)
      .build();

    const visited: string[] = [];
    await container.traverse((node) => {
      visited.push(node.id);
    });

    expect(visited).toEqual(['Config', 'Service']);
    expect(calls).toEqual([]);
  });
});

describe('сверка роли с позицией', () => {
  it('класс-юнит пайплайна с ролью хендлера принимается в providers:', () => {
    // Юнит пайплайна несёт метод `handle` и потому объявлен `@Handler`;
    // его место — `providers:`, в отличие от класса-хендлера endpoint'а,
    // который регистрирует сам endpoint
    @Handler([])
    class TrackSubscription {
      handle(): string {
        return 'ok';
      }
    }

    const container = new ContainerBuilder()
      .register(TrackSubscription as unknown as new () => unknown)
      .build();

    expect(container.has(TrackSubscription)).toBe(true);
  });

  it('ресурс в слоте handler: отвергается', () => {
    @Resource([])
    class Database {
      static async acquire(_signal: AbortSignal): Promise<Database> {
        return new Database();
      }

      release(): void {}
    }

    const builder = new ContainerBuilder();

    expect(() =>
      builder.registerHandlerIn(
        'module:users',
        Database as unknown as new () => unknown,
      ),
    ).toThrow(
      /Class 'Database' is declared @Resource, but the 'handler:' slot accepts @Handler/,
    );
  });

  it('класс без роли отвергается с подсказкой про factoryProvider', () => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class Foreign {}

    const builder = new ContainerBuilder();

    expect(() => builder.register(Foreign)).toThrow(
      /has no role decorator.*factoryProvider or resourceProvider/s,
    );
  });

  it('компонент и ресурс в providers: принимаются', () => {
    @Component([])
    class Service {}

    @Resource([])
    class Database {
      static async acquire(_signal: AbortSignal): Promise<Database> {
        return new Database();
      }

      release(): void {}
    }

    const container = new ContainerBuilder()
      .register(
        makeModule({ name: 'module:users', providers: [Service, Database] }),
      )
      .build();

    expect(container.has(Service)).toBe(true);
    expect(container.has(Database)).toBe(true);
  });

  it('класс-хендлер регистрируется через registerHandlerIn', () => {
    @Handler([])
    class ListUsersHandler {
      handle(): string {
        return 'ok';
      }
    }

    const container = new ContainerBuilder()
      .registerHandlerIn('module:users', ListUsersHandler)
      .build();

    expect(container.has(ListUsersHandler)).toBe(true);
  });
});
