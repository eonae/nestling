import { makeToken } from '../common.js';

import { Injectable } from './injectable.decorator.js';
import { readInjectableMeta } from './injectable.metadata.js';
import {
  classProvider,
  factoryProvider,
  isClassDefinition,
  isFactoryProvider,
  isValueDefinition,
  valueProvider,
} from './variants.js';

describe('конструкторы провайдеров', () => {
  interface IService {
    ready(): boolean;
  }

  const TokenService = makeToken<IService>('TokenService');

  @Injectable(TokenService, [] as const)
  class Service implements IService {
    ready(): boolean {
      return true;
    }
  }

  it('создаёт провайдер класса из класса с @Injectable', () => {
    const provider = classProvider(TokenService, Service);

    expect(provider.provide).toBe(TokenService);
    expect(provider.useClass).toBe(Service);
    expect(provider.deps).toEqual([]);
    expect(isClassDefinition(provider)).toBe(true);
  });

  it('бросает ошибку для класса без @Injectable', () => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class Plain {}

    expect(() => classProvider(TokenService, Plain)).toThrow(
      /can't be used in classProvider without @Injectable decorator/,
    );
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

  it('хранит метаданные @Injectable в WeakMap', () => {
    const metadata = readInjectableMeta(Service);

    expect(metadata?.injectionToken).toBe(TokenService);
    expect(metadata?.dependencies).toEqual([]);
  });
});
