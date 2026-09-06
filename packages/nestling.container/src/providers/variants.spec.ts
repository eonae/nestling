import type { Constructor } from '../common.js';
import { makeToken } from '../common.js';

import { Component, Handler, Resource } from './role.decorators.js';
import { readRoleMeta } from './role.metadata.js';
import {
  classProvider,
  factoryProvider,
  isClassDefinition,
  isFactoryProvider,
  isResourceDefinition,
  isValueDefinition,
  resourceProvider,
  valueProvider,
} from './variants.js';

describe('конструкторы провайдеров', () => {
  interface IService {
    ready(): boolean;
  }

  const TokenService = makeToken<IService>('TokenService');

  @Component()
  class Service implements IService {
    ready(): boolean {
      return true;
    }
  }

  it('создаёт провайдер класса из компонента', () => {
    const provider = classProvider(TokenService, Service);

    expect(provider.provide).toBe(TokenService);
    expect(isClassDefinition(provider)).toBe(true);
    expect((provider as { useClass: unknown }).useClass).toBe(Service);
    expect(provider.deps).toEqual([]);
  });

  it('бросает ошибку для класса без декоратора роли', () => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class Plain {}

    expect(() => classProvider(TokenService, Plain)).toThrow(
      /has no role decorator/,
    );
  });

  it('бросает ошибку для класса-хендлера', () => {
    @Handler()
    class Endpoint {
      handle(): boolean {
        return true;
      }
    }

    expect(() =>
      // Тип `classProvider` хендлер и так не принимает; проверяется, что
      // из JS вызов падает понятной ошибкой
      classProvider(TokenService, Endpoint as unknown as Constructor<IService>),
    ).toThrow(/is declared @Handler/);
  });

  it('из класса-ресурса делает провайдер ресурса', async () => {
    const released: string[] = [];

    @Resource()
    class Connection {
      static async acquire(): Promise<Connection> {
        return new Connection();
      }

      release(): void {
        released.push('connection');
      }
    }

    const Connection$ = makeToken<Connection>('Connection$');
    const provider = classProvider(Connection$, Connection);

    expect(isResourceDefinition(provider)).toBe(true);

    const resource = provider as {
      acquire: (...args: unknown[]) => Promise<unknown>;
      release: (value: unknown) => void;
    };

    const value = await resource.acquire(new AbortController().signal);
    resource.release(value);

    expect(value).toBeInstanceOf(Connection);
    expect(released).toEqual(['connection']);
  });

  it('создаёт провайдер значения', () => {
    const value: IService = { ready: () => true };
    const provider = valueProvider(TokenService, value);

    expect(provider.provide).toBe(TokenService);
    expect(provider.useValue).toBe(value);
    expect(isValueDefinition(provider)).toBe(true);
  });

  it('создаёт фабричный провайдер с типизированными зависимостями', () => {
    const TokenDep = makeToken<string>('Dep');

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const factory = (dep: string): IService => ({
      ready: () => dep.length > 0,
    });

    const provider = factoryProvider(TokenService, factory, [
      TokenDep,
    ] as const);

    expect(provider.provide).toBe(TokenService);
    expect(provider.useFactory).toBe(factory);
    expect(provider.deps).toEqual([TokenDep]);
    expect(isFactoryProvider(provider)).toBe(true);
  });

  it('создаёт провайдер ресурса функциональной формой', () => {
    const Dsn = makeToken<string>('Dsn');
    const Pool$ = makeToken<{ end(): void }>('Pool');

    const provider = resourceProvider(Pool$, {
      deps: [Dsn] as const,
      acquire: (dsn: string) => ({ end: () => dsn }),
      release: (pool) => pool.end(),
    });

    expect(provider.provide).toBe(Pool$);
    expect(provider.deps).toEqual([Dsn]);
    expect(isResourceDefinition(provider)).toBe(true);
  });

  it('хранит метаданные роли в WeakMap', () => {
    const metadata = readRoleMeta(Service);

    expect(metadata?.role).toBe('component');
    expect(metadata?.dependencies).toEqual([]);
  });
});
