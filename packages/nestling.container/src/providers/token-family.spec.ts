import { ContainerBuilder } from '../builder';
import type { TokenString } from '../common';
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

  it('rejects the parameter reserved for the .all sentinel', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'ReservedAllLogger',
    );

    expect(() => ILogger('{all}')).toThrow(
      /Parameter '{all}' is reserved for 'ReservedAllLogger\.all'/,
    );
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

describe('Family.all sentinel', () => {
  it('has the "<family>:{all}" id', () => {
    const IHealthCheck = makeTokenFamily<ILoggerService, [name: string]>(
      'HealthCheck',
    );

    expect(IHealthCheck.all).toBe('HealthCheck:{all}');
  });

  it('is typed as a token of a readonly array of members', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'TypedAllLogger',
    );

    // Compile-time assertions: the sentinel carries `readonly T[]`, so a
    // consumer declaring a mutable array would not typecheck.
    const token: TokenString<readonly ILoggerService[]> = ILogger.all;

    @Injectable([ILogger.all])
    class Aggregator {
      constructor(readonly loggers: readonly ILoggerService[]) {}
    }

    expect(token).toBe('TypedAllLogger:{all}');
    expect(injectableMetaStorage.get(Aggregator)?.dependencies).toEqual([
      'TypedAllLogger:{all}',
    ]);
  });

  it('is not a family member: the sentinel is not memoized as one', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'DistinctAllLogger',
    );

    expect(ILogger.all).not.toBe(ILogger('all'));
    expect(ILogger.all).not.toBe(ILogger.auto);
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
