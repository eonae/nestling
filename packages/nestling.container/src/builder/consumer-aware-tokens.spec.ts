import type { Constructor } from '../common';
import { makeToken } from '../common';
import {
  factoryProvider,
  familyProvider,
  Injectable,
  makeTokenFamily,
  valueProvider,
} from '../providers';

import { ContainerBuilder } from './container.builder';

interface ILoggerService {
  scope: string;
}

describe('Family.auto', () => {
  it('заменяется на члена с именем класса-потребителя', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('AutoOne');

    @Injectable([ILogger.auto])
    class CreateUserEndpoint {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = await new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      )
      .register(CreateUserEndpoint)
      .build();

    expect(container.getOrThrow(CreateUserEndpoint).logger.scope).toBe(
      'CreateUserEndpoint',
    );
    expect(container.getOrThrow(ILogger('CreateUserEndpoint')).scope).toBe(
      'CreateUserEndpoint',
    );
  });

  it('даёт двум потребителям двух разных членов из одного рецепта', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('AutoTwo');

    @Injectable([ILogger.auto])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    @Injectable([ILogger.auto])
    class ServiceB {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = await new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      )
      .register(ServiceA, ServiceB)
      .build();

    const json = await container.toJSON();
    const ids = json.nodes.map((node) => node.id);

    expect(ids).toContain('AutoTwo:ServiceA');
    expect(ids).toContain('AutoTwo:ServiceB');
    expect(container.getOrThrow(ServiceA).logger).not.toBe(
      container.getOrThrow(ServiceB).logger,
    );
  });

  it('совпадает с явным членом того же имени', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'AutoDedup',
    );
    const IReport = makeToken<string>('AutoDedupReport');

    @Injectable([ILogger.auto])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = await new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      )
      .register(ServiceA)
      .register(
        factoryProvider(IReport, (logger: ILoggerService) => logger.scope, [
          ILogger('ServiceA'),
        ] as const),
      )
      .build();

    const json = await container.toJSON();

    expect(
      json.nodes.filter((node) => node.id === 'AutoDedup:ServiceA'),
    ).toHaveLength(1);
    expect(container.getOrThrow(IReport)).toBe('ServiceA');
  });

  it('отклоняет .auto в deps фабричного провайдера', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'AutoFactory',
    );
    const IReport = makeToken<string>('AutoFactoryReport');

    const builder = new ContainerBuilder().register(
      familyProvider(ILogger, (scope) =>
        valueProvider(ILogger(scope), { scope }),
      ),
    );

    expect(() =>
      builder.register(
        factoryProvider(IReport, (logger: ILoggerService) => logger.scope, [
          ILogger.auto,
        ] as const),
      ),
    ).toThrow(
      /'AutoFactory.auto' is only allowed in deps of a class decorated with @Injectable/,
    );
  });

  it('отклоняет .auto у анонимного класса', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'AutoAnon',
    );

    const decorate = Injectable([ILogger.auto]);
    const anonymous = class {
      constructor(readonly logger: ILoggerService) {}
    };
    Object.defineProperty(anonymous, 'name', { value: '' });

    expect(() =>
      decorate(
        anonymous as unknown as Constructor,
        {} as ClassDecoratorContext<Constructor>,
      ),
    ).toThrow(/Cannot resolve 'AutoAnon.auto'/);
  });
});
