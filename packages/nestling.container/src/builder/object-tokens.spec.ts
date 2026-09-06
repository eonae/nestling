import { makeToken, tokenId } from '../common.js';
import { Component, valueProvider } from '../providers/index.js';

import { ContainerBuilder } from './container.builder.js';

interface ILogger {
  scope: string;
}

describe('идентичность DI-токена', () => {
  it('два вызова makeToken с одним id дают разные DI-токены', () => {
    const first = makeToken<ILogger>('ILogger');
    const second = makeToken<ILogger>('ILogger');

    expect(second).not.toBe(first);
    expect(tokenId(first)).toBe('ILogger');
  });

  it('однофамильцы из разных пакетов не сливаются', async () => {
    // Два класса с одним именем — ровно та ситуация, которую даёт
    // одноимённый экспорт из двух npm-пакетов
    const Logger = class Logger {
      readonly source = 'left';
    };
    const OtherLogger = class Logger {
      readonly source = 'right';
    };

    // Декоратор применяется напрямую, а не через `@`: форма класса
    // компилятору здесь неизвестна, поэтому вызов проходит мимо проверки
    // формы так же, как в role.decorators.spec.ts
    const decorateComponent = Component as unknown as (
      deps: unknown[],
    ) => (target: unknown) => unknown;

    decorateComponent([])(Logger);
    decorateComponent([])(OtherLogger);

    const container = new ContainerBuilder()
      .register(Logger)
      .register(OtherLogger)
      .build();

    await container.init();

    expect(container.getOrThrow(Logger).source).toBe('left');
    expect(container.getOrThrow(OtherLogger).source).toBe('right');

    const { nodes } = await container.toJSON();
    expect(nodes.filter((node) => node.id.startsWith('Logger'))).toHaveLength(
      2,
    );
  });

  it('отдаёт предупреждение о совпавших идентификаторах узлов значением', async () => {
    const first = makeToken<string>('Duplicated');
    const second = makeToken<string>('Duplicated');

    const container = new ContainerBuilder()
      .register(valueProvider(first, 'left'))
      .register(valueProvider(second, 'right'))
      .build();

    await container.init();

    expect(container.getOrThrow(first)).toBe('left');
    expect(container.getOrThrow(second)).toBe('right');
    expect(container.warnings).toHaveLength(1);
    expect(container.warnings[0]).toContain(
      'ambiguous DI token ids: Duplicated',
    );
    expect(Object.isFrozen(container.warnings)).toBe(true);

    // Адреса разошлись, поэтому отчёт остаётся читаемым и в этом случае
    expect(container.getById('Duplicated')).toBe('left');
    expect(container.getById('Duplicated#2')).toBe('right');
  });

  it('отдаёт экземпляр по адресу узла из отчёта', async () => {
    const ILogger = makeToken<ILogger>('ReportedLogger');

    const container = new ContainerBuilder()
      .register(valueProvider(ILogger, { scope: 'users' }))
      .build();

    const { nodes } = await container.toJSON();
    const [node] = nodes;

    await container.init();

    expect(container.getById(node.id)).toBe(container.getOrThrow(ILogger));
    expect(container.getById('nothing-like-this')).toBeNull();
  });
});
