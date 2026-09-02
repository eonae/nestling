import { ContainerBuilder } from '../builder';
import type { Token } from '../common';
import { makeToken } from '../common';

import { Injectable } from './injectable.decorator';
import { injectableMetaStorage } from './injectable.metadata';
import { familyOf, isTokenFamily, makeTokenFamily } from './token-family';
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

    expect(ILogger('users').id).toBe('Logger:users');
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

  it('хранит семейство и параметр полями токена', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'StructuralLogger',
    );

    const member = ILogger('users');

    expect(member.family).toBe(ILogger);
    expect(member.param).toBe('users');
    expect(familyOf(member)).toBe(ILogger);
  });

  it('токен, лишь похожий на члена, членом не является', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'LookalikeLogger',
    );
    const handmade = makeToken<ILoggerService>('LookalikeLogger:users');

    expect(handmade).not.toBe(ILogger('users'));
    expect(familyOf(handmade)).toBeUndefined();
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
  it('имеет идентификатор "<family>.all"', () => {
    const IHealthCheck = makeTokenFamily<ILoggerService, [name: string]>(
      'HealthCheck',
    );

    expect(IHealthCheck.all.id).toBe('HealthCheck.all');
  });

  it('типизирован как токен массива readonly членов', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'TypedAllLogger',
    );

    // Проверка типов: токен несёт `readonly T[]`, поэтому потребитель с
    // изменяемым массивом не скомпилируется.
    const token: Token<readonly ILoggerService[]> = ILogger.all;

    @Injectable([ILogger.all])
    class Aggregator {
      constructor(readonly loggers: readonly ILoggerService[]) {}
    }

    expect(token).toBe(ILogger.all);
    expect(injectableMetaStorage.get(Aggregator)?.dependencies).toEqual([
      ILogger.all,
    ]);
  });

  it('не является членом семейства', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'DistinctAllLogger',
    );

    expect(ILogger.all).not.toBe(ILogger('all'));
    expect(ILogger.all).not.toBe(ILogger.auto);
    expect(familyOf(ILogger.all)).toBeUndefined();
  });

  it('пользовательский параметр не сталкивается со служебным', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'ReservedFreeLogger',
    );

    expect(ILogger('all')).not.toBe(ILogger.all);
    expect(ILogger('auto')).not.toBe(ILogger.auto);
    expect(ILogger('all').param).toBe('all');
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
      ILogger('meta'),
    ]);
  });
});
