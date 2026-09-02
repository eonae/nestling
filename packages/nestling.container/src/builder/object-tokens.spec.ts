import { makeToken, tokenId } from '../common';
import { Injectable, valueProvider } from '../providers';

import { ContainerBuilder } from './container.builder';

interface ILogger {
  scope: string;
}

/** Перехватывает `console.warn` на время вызова и отдаёт собранные строки. */
const captureWarnings = async <T>(
  body: () => Promise<T>,
): Promise<[T, string[]]> => {
  /* eslint-disable no-console -- перехват предупреждения и есть предмет теста */
  const warnings: string[] = [];
  const original = console.warn;

  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map(String).join(' '));
  };

  try {
    return [await body(), warnings];
  } finally {
    console.warn = original;
  }
  /* eslint-enable no-console */
};

describe('идентичность токена', () => {
  it('два вызова makeToken с одним id дают разные токены', () => {
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

    Injectable([])(Logger, {} as ClassDecoratorContext);
    Injectable([])(OtherLogger, {} as ClassDecoratorContext);

    const [container] = await captureWarnings(() =>
      new ContainerBuilder().register(Logger).register(OtherLogger).build(),
    );

    expect(container.getOrThrow(Logger).source).toBe('left');
    expect(container.getOrThrow(OtherLogger).source).toBe('right');

    const { nodes } = await container.toJSON();
    expect(nodes.filter((node) => node.id.startsWith('Logger'))).toHaveLength(
      2,
    );
  });

  it('предупреждает о совпавших идентификаторах узлов', async () => {
    const first = makeToken<string>('Duplicated');
    const second = makeToken<string>('Duplicated');

    const [container, warnings] = await captureWarnings(() =>
      new ContainerBuilder()
        .register(valueProvider(first, 'left'))
        .register(valueProvider(second, 'right'))
        .build(),
    );

    expect(container.getOrThrow(first)).toBe('left');
    expect(container.getOrThrow(second)).toBe('right');
    expect(warnings.join('\n')).toContain('ambiguous token ids: Duplicated');

    // Адреса разошлись, поэтому отчёт остаётся читаемым и в этом случае
    expect(container.getById('Duplicated')).toBe('left');
    expect(container.getById('Duplicated#2')).toBe('right');
  });

  it('отдаёт экземпляр по адресу узла из отчёта', async () => {
    const ILogger = makeToken<ILogger>('ReportedLogger');

    const container = await new ContainerBuilder()
      .register(valueProvider(ILogger, { scope: 'users' }))
      .build();

    const { nodes } = await container.toJSON();
    const [node] = nodes;

    expect(container.getById(node.id)).toBe(container.getOrThrow(ILogger));
    expect(container.getById('nothing-like-this')).toBeNull();
  });
});
