import { ContainerBuilder } from '../builder';
import { makeToken } from '../common';

import { Injectable } from './injectable.decorator';
import { injectableMetaStorage } from './injectable.metadata';
import { isTokenFamily, makeTokenFamily } from './token-family';
import {
  factoryProvider,
  familyProvider,
  isFamilyDefinition,
  valueProvider,
} from './variants';

interface ILoggerService {
  scope: string;
}

const makeLogger = (scope: string): ILoggerService => ({ scope });

describe('makeTokenFamily', () => {
  it('creates member tokens with "<family>:<param>" ids', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Logger');

    expect(ILogger('users')).toBe('Logger:users');
    expect(ILogger.familyName).toBe('Logger');
  });

  it('memoizes members: the same parameter yields the same token', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'MemoLogger',
    );

    const first = ILogger('users');
    const second = ILogger('users');

    expect(second).toBe(first);
  });

  it('rejects the parameter reserved for the .auto sentinel', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'ReservedLogger',
    );

    expect(() => ILogger('{auto}')).toThrow(/reserved/);
  });

  it('recognizes families and family definitions', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'GuardLogger',
    );
    const definition = familyProvider(ILogger, (scope) =>
      valueProvider(ILogger(scope), makeLogger(scope)),
    );

    expect(isTokenFamily(ILogger)).toBe(true);
    expect(isTokenFamily(ILogger('users'))).toBe(false);
    expect(isFamilyDefinition(definition)).toBe(true);
    expect(
      isFamilyDefinition(valueProvider(ILogger('users'), makeLogger('u'))),
    ).toBe(false);
  });
});

describe('family member as an ordinary injection token', () => {
  it('is injectable into a class and readable from the container', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'PlainLogger',
    );

    @Injectable([ILogger('users')])
    class UserService {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = await new ContainerBuilder()
      .register(valueProvider(ILogger('users'), makeLogger('users')))
      .register(UserService)
      .build();

    const logger = container.getOrThrow(ILogger('users'));
    const service = container.getOrThrow(UserService);

    expect(logger.scope).toBe('users');
    expect(service.logger).toBe(logger);
    expect(container.get(ILogger('users'))).toBe(logger);
  });

  it('is usable in factory provider deps', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'FactoryLogger',
    );

    const IReporter = makeToken<string>('Reporter');

    const container = await new ContainerBuilder()
      .register(valueProvider(ILogger('db'), makeLogger('db')))
      .register(
        factoryProvider(IReporter, (logger: ILoggerService) => logger.scope, [
          ILogger('db'),
        ] as const),
      )
      .build();

    expect(container.getOrThrow(IReporter)).toBe('db');
  });

  it('records the resolved member token in @Injectable metadata', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'MetaLogger',
    );

    @Injectable([ILogger('meta')])
    class MetaService {
      constructor(readonly logger: ILoggerService) {}
    }

    expect(injectableMetaStorage.get(MetaService)?.dependencies).toEqual([
      'MetaLogger:meta',
    ]);
  });
});
