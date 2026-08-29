import { makeToken } from '../common';
import { makeModule } from '../modules';
import {
  classProvider,
  familyProvider,
  Injectable,
  makeTokenFamily,
  valueProvider,
} from '../providers';

import { ContainerBuilder } from './container.builder';

interface ILoggerService {
  scope: string;
}

const ISecret = makeToken<string>('Secret');
const IOther = makeToken<string>('Other');

describe('strictExports выключен по умолчанию', () => {
  it('разрешает зависимость между модулями от неэкспортированного токена', async () => {
    @Injectable([ISecret])
    class Consumer {
      constructor(readonly secret: string) {}
    }

    const Owner = makeModule({
      name: 'module:owner',
      providers: [valueProvider(ISecret, 'shh')],
    });

    const container = await new ContainerBuilder()
      .register(Owner)
      .register(makeModule({ name: 'module:consumer', providers: [Consumer] }))
      .build();

    expect(container.getOrThrow(Consumer).secret).toBe('shh');
  });
});

describe('strictExports включён', () => {
  it('проходит, если токен зависимости экспортирован', async () => {
    @Injectable([ISecret])
    class Consumer {
      constructor(readonly secret: string) {}
    }

    const Owner = makeModule({
      name: 'module:owner',
      providers: [valueProvider(ISecret, 'shh')],
      exports: [ISecret],
    });

    const container = await new ContainerBuilder({ strictExports: true })
      .register(Owner)
      .register(makeModule({ name: 'module:consumer', providers: [Consumer] }))
      .build();

    expect(container.getOrThrow(Consumer).secret).toBe('shh');
  });

  it('разрешает ребро внутри модуля к неэкспортированному токену', async () => {
    @Injectable([ISecret])
    class Consumer {
      constructor(readonly secret: string) {}
    }

    const Owner = makeModule({
      name: 'module:owner',
      providers: [valueProvider(ISecret, 'shh'), Consumer],
      exports: [makeToken<unknown>('Unrelated')],
    });

    const container = await new ContainerBuilder({ strictExports: true })
      .register(Owner)
      .build();

    expect(container.getOrThrow(Consumer).secret).toBe('shh');
  });

  it('разрешает зависимости без модуля', async () => {
    @Injectable([ISecret])
    class Consumer {
      constructor(readonly secret: string) {}
    }

    const container = await new ContainerBuilder({ strictExports: true })
      .register(valueProvider(ISecret, 'shh'))
      .register(makeModule({ name: 'module:consumer', providers: [Consumer] }))
      .build();

    expect(container.getOrThrow(Consumer).secret).toBe('shh');
  });

  it('разрешает члена семейства, если модуль экспортирует семейство', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'ExportedFamily',
    );

    @Injectable([ILogger('users')])
    class Consumer {
      constructor(readonly logger: ILoggerService) {}
    }

    const LoggingModule = makeModule({
      name: 'module:logging',
      providers: [
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      ],
      exports: [ILogger],
    });

    const container = await new ContainerBuilder({ strictExports: true })
      .register(LoggingModule)
      .register(makeModule({ name: 'module:consumer', providers: [Consumer] }))
      .build();

    const json = await container.toJSON();
    const member = json.nodes.find(
      (node) => node.id === 'ExportedFamily:users',
    );

    expect(member?.metadata.exported).toBe(true);
    expect(container.getOrThrow(Consumer).logger.scope).toBe('users');
  });

  it('падает на неэкспортированной зависимости между модулями', async () => {
    @Injectable([ISecret])
    class Consumer {
      constructor(readonly secret: string) {}
    }

    const Owner = makeModule({
      name: 'module:owner',
      providers: [valueProvider(ISecret, 'shh')],
      exports: [makeToken<unknown>('Unrelated')],
    });

    const builder = new ContainerBuilder({ strictExports: true })
      .register(Owner)
      .register(makeModule({ name: 'module:consumer', providers: [Consumer] }));

    await expect(builder.build()).rejects.toThrow(
      /Consumer → Secret \(module:owner\)/,
    );
  });

  it('считает модуль без exports не экспортирующим ничего', async () => {
    @Injectable([ISecret])
    class Consumer {
      constructor(readonly secret: string) {}
    }

    const Owner = makeModule({
      name: 'module:owner',
      providers: [valueProvider(ISecret, 'shh')],
    });

    const builder = new ContainerBuilder({ strictExports: true })
      .register(Owner)
      .register(makeModule({ name: 'module:consumer', providers: [Consumer] }));

    await expect(builder.build()).rejects.toThrow(
      /Consumer → Secret \(module:owner\)/,
    );
  });

  it('падает на члене семейства, которое не экспортировано', async () => {
    const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
      'PrivateFamily',
    );

    @Injectable([ILogger('users')])
    class Consumer {
      constructor(readonly logger: ILoggerService) {}
    }

    const LoggingModule = makeModule({
      name: 'module:logging',
      providers: [
        familyProvider(ILogger, (scope) =>
          valueProvider(ILogger(scope), { scope }),
        ),
      ],
    });

    const builder = new ContainerBuilder({ strictExports: true })
      .register(LoggingModule)
      .register(makeModule({ name: 'module:consumer', providers: [Consumer] }));

    await expect(builder.build()).rejects.toThrow(
      /Consumer → PrivateFamily:users \(module:logging\)/,
    );
  });

  it('сообщает все нарушения одной ошибкой', async () => {
    @Injectable([ISecret, IOther])
    class ConsumerA {
      constructor(
        readonly secret: string,
        readonly other: string,
      ) {}
    }

    const OwnerA = makeModule({
      name: 'module:owner-a',
      providers: [valueProvider(ISecret, 'shh')],
    });

    const OwnerB = makeModule({
      name: 'module:owner-b',
      providers: [valueProvider(IOther, 'nope')],
    });

    const builder = new ContainerBuilder({ strictExports: true })
      .register(OwnerA, OwnerB)
      .register(
        makeModule({ name: 'module:consumer', providers: [ConsumerA] }),
      );

    const error = await builder.build().catch((error_: Error) => error_);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /ConsumerA → Secret \(module:owner-a\)/,
    );
    expect((error as Error).message).toMatch(
      /ConsumerA → Other \(module:owner-b\)/,
    );
  });

  it('сохраняет metadata.exported у модулей с exports', async () => {
    const IExported = makeToken<string>('ExportedToken');
    const IHidden = makeToken<string>('HiddenToken');

    const Owner = makeModule({
      name: 'module:mixed',
      providers: [
        valueProvider(IExported, 'public'),
        valueProvider(IHidden, 'private'),
      ],
      exports: [IExported],
    });

    const container = await new ContainerBuilder().register(Owner).build();
    const json = await container.toJSON();

    expect(
      json.nodes.find((node) => node.id === 'ExportedToken')?.metadata.exported,
    ).toBe(true);
    expect(
      json.nodes.find((node) => node.id === 'HiddenToken')?.metadata.exported,
    ).toBe(false);
  });
});

describe('exports модуля принимает классы и семейства вместе', () => {
  it('экспортирует класс и семейство из одного модуля', async () => {
    const IMetrics = makeTokenFamily<{ name: string }, [name: string]>(
      'MixedMetrics',
    );
    const IService = makeToken<{ id: string }>('MixedService');

    @Injectable(IService, [])
    class Service {
      readonly id = 'service';
    }

    @Injectable([IService, IMetrics('http')])
    class Consumer {
      constructor(
        readonly service: { id: string },
        readonly metrics: { name: string },
      ) {}
    }

    const Owner = makeModule({
      name: 'module:mixed-owner',
      providers: [
        classProvider(IService, Service),
        familyProvider(IMetrics, (name) =>
          valueProvider(IMetrics(name), { name }),
        ),
      ],
      exports: [IService, IMetrics],
    });

    const container = await new ContainerBuilder({ strictExports: true })
      .register(Owner)
      .register(
        makeModule({ name: 'module:mixed-consumer', providers: [Consumer] }),
      )
      .build();

    expect(container.getOrThrow(Consumer).metrics.name).toBe('http');
  });
});
