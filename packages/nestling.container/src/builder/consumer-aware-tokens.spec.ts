import { makeToken } from '../common.js';
import {
  Component,
  factoryProvider,
  familyProvider,
  makeTokenFamily,
  valueProvider,
} from '../providers/index.js';

import { ContainerBuilder } from './container.builder.js';

interface ILoggerService {
  scope: string;
}

describe('Family.auto', () => {
  it('заменяется на члена с именем класса-потребителя', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('AutoOne');

    @Component([ILogger.auto])
    class CreateUserEndpoint {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      )
      .register(CreateUserEndpoint)
      .build();

    await container.init();

    expect(container.getOrThrow(CreateUserEndpoint).logger.scope).toBe(
      'CreateUserEndpoint',
    );
    expect(container.getOrThrow(ILogger('CreateUserEndpoint')).scope).toBe(
      'CreateUserEndpoint',
    );
  });

  it('даёт двум потребителям двух разных членов из одного рецепта', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('AutoTwo');

    @Component([ILogger.auto])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    @Component([ILogger.auto])
    class ServiceB {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = new ContainerBuilder()
      .register(
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      )
      .register(ServiceA, ServiceB)
      .build();

    await container.init();

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

    @Component([ILogger.auto])
    class ServiceA {
      constructor(readonly logger: ILoggerService) {}
    }

    const container = new ContainerBuilder()
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

    await container.init();

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
      /'AutoFactory.auto' is only allowed in deps of a class with a role decorator/,
    );
  });

  it('отклоняет .auto у анонимного класса', () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'AutoAnon',
    );

    // Декоратор применяется напрямую, а не через `@`: форма класса
    // компилятору здесь неизвестна, поэтому вызов проходит мимо проверки
    // формы так же, как в role.decorators.spec.ts
    const decorate = Component([ILogger.auto]) as unknown as (
      target: unknown,
    ) => unknown;
    const anonymous = class {
      constructor(readonly logger: ILoggerService) {}
    };
    Object.defineProperty(anonymous, 'name', { value: '' });

    expect(() => decorate(anonymous)).toThrow(/Cannot resolve 'AutoAnon.auto'/);
  });
});
