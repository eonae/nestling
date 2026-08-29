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
  it('создаёт токены членов с идентификатором "<family>:<param>"', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Logger');

    expect(ILogger('users')).toBe('Logger:users');
    expect(ILogger.familyName).toBe('Logger');
  });

  it('мемоизирует членов: один параметр даёт один токен', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'MemoLogger',
    );

    const first = ILogger('users');
    const second = ILogger('users');

    expect(second).toBe(first);
  });

  it('отклоняет параметр, зарезервированный за .auto', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'ReservedLogger',
    );

    expect(() => ILogger('{auto}')).toThrow(/reserved/);
  });

  it('отклоняет параметр, зарезервированный за .all', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'ReservedAllLogger',
    );

    expect(() => ILogger('{all}')).toThrow(
      /Parameter '{all}' is reserved for 'ReservedAllLogger\.all'/,
    );
  });

  it('распознаёт семейства и рецепты семейств', () => {
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

describe('токен Family.all', () => {
  it('имеет идентификатор "<family>:{all}"', () => {
    const IHealthCheck = makeTokenFamily<ILoggerService, [name: string]>(
      'HealthCheck',
    );

    expect(IHealthCheck.all).toBe('HealthCheck:{all}');
  });

  it('типизирован как токен массива readonly членов', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'TypedAllLogger',
    );

    // Проверка типов: токен несёт `readonly T[]`, поэтому потребитель с
    // изменяемым массивом не скомпилируется.
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

  it('не является членом семейства', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'DistinctAllLogger',
    );

    expect(ILogger.all).not.toBe(ILogger('all'));
    expect(ILogger.all).not.toBe(ILogger.auto);
  });
});

describe('член семейства как обычный токен', () => {
  it('инжектируется в класс и читается из контейнера', async () => {
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

  it('принимается в deps фабричного провайдера', async () => {
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

  it('записывает токен члена в метаданные @Injectable', () => {
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
