import { makeToken } from '../common';

import { Injectable } from './injectable.decorator';
import { injectableMetaStorage } from './injectable.metadata';
import {
  classProvider,
  factoryProvider,
  isClassDefinition,
  isFactoryProvider,
  isValueDefinition,
  valueProvider,
} from './variants';

describe('Provider variants', () => {
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

  it('creates class provider from decorated class', () => {
    const provider = classProvider(TokenService, Service);

    expect(provider.provide).toBe(TokenService);
    expect(provider.useClass).toBe(Service);
    expect(provider.deps).toEqual([]);
    expect(isClassDefinition(provider)).toBe(true);
  });

  it('throws if class lacks @Injectable metadata', () => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class Plain {}

    expect(() => classProvider(TokenService, Plain)).toThrow(
      /can't be used in classProvider without @Injectable decorator/,
    );
  });

  it('creates value provider', () => {
    const value: IService = { ready: () => true };
    const provider = valueProvider(TokenService, value);

    expect(provider.provide).toBe(TokenService);
    expect(provider.useValue).toBe(value);
    expect(isValueDefinition(provider)).toBe(true);
  });

  it('creates factory provider with typed deps', () => {
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

  it('stores @Injectable metadata in WeakMap', () => {
    const metadata = injectableMetaStorage.get(Service);

    expect(metadata?.injectionToken).toBe(TokenService);
    expect(metadata?.dependencies).toEqual([]);
  });
});
