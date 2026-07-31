import type { SectionDeclaration } from './declaration.js';
import { ConfigKeys } from './keys.js';
import { ConfigReader } from './reader.js';
import { registerSection, resetConfigRegistry } from './registry.js';
import type { ConfigSource } from './source.js';
import { objectSource } from './source.js';

import { jest } from '@jest/globals';

const schema = {
  '~standard': { version: 1, vendor: 'test', validate: () => ({ value: 1 }) },
} as const;

const declaration = (prefix: string, keys: readonly string[]) =>
  ({
    prefix,
    reloadable: false,
    fields: keys.map((key) => ({ name: key, key, exact: true, schema })),
    keys: new ConfigKeys(prefix, keys),
    consumed: false,
  }) satisfies SectionDeclaration;

const warnings: string[] = [];
const onWarn = (message: string): void => {
  warnings.push(message);
};

/** Заглушка вместо `console.warn` — правило запрещает пустое тело. */
const noop = (): void => {
  return;
};

/** Источник, который никогда ничего не знает — «пропускаю ход» на любой ключ. */
const silent = (name: string): ConfigSource => ({
  name,
  // eslint-disable-next-line unicorn/no-useless-undefined
  get: () => undefined,
});

beforeEach(() => {
  resetConfigRegistry();
  warnings.length = 0;
  delete process.env.ORDERS_MAX_ITEMS;
});

describe('разрешение ключа', () => {
  it('порядок привязок задаёт приоритет', async () => {
    const first = objectSource({ ORDERS_MAX_ITEMS: 'first' }, 'first');
    const second = objectSource({ ORDERS_MAX_ITEMS: 'second' }, 'second');

    const reader = new ConfigReader(
      [
        [first, '*'],
        [second, '*'],
      ],
      { onWarn },
    );
    await reader.init();

    expect(reader.read('ORDERS_MAX_ITEMS')).toBe('first');
  });

  it('провал до env, а без env — undefined', async () => {
    process.env.ORDERS_MAX_ITEMS = 'from-env';

    const empty = objectSource({}, 'empty');
    const reader = new ConfigReader([[empty, '*']], { onWarn });
    await reader.init();

    expect(reader.read('ORDERS_MAX_ITEMS')).toBe('from-env');
    expect(reader.read('NOT_SET_ANYWHERE')).toBeUndefined();
  });

  it('без привязок читалка тривиальна — работает один env-пол', async () => {
    process.env.ORDERS_MAX_ITEMS = 'bare-env';

    const reader = new ConfigReader();
    await reader.init();

    expect(reader.read('ORDERS_MAX_ITEMS')).toBe('bare-env');
  });

  it('источник не опрашивается для ключей вне его таргета', async () => {
    const get = jest.fn(() => 'x');
    const scoped: ConfigSource = { name: 'scoped', get };

    const reader = new ConfigReader(
      [[scoped, new ConfigKeys('orders', ['ORDERS_MAX_ITEMS'])]],
      { onWarn },
    );
    await reader.init();

    reader.read('USERS_PAGE_SIZE');
    expect(get).not.toHaveBeenCalled();

    reader.read('ORDERS_MAX_ITEMS');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('ORDERS_MAX_ITEMS');
  });

  it('перечисляет опрошенные источники в порядке приоритета', () => {
    // Второй источник намеренно безымянный: он должен получить позиционное имя
    const anonymous: ConfigSource = { ...silent('x'), name: undefined };

    const reader = new ConfigReader(
      [
        [objectSource({}, 'vault'), '*'],
        [anonymous, '*'],
      ],
      { onWarn },
    );

    expect(reader.sources).toEqual(['vault', 'source #2', 'process.env']);
  });
});

describe('жизненный цикл источников', () => {
  it('init() отрабатывает до любого чтения', async () => {
    const order: string[] = [];
    const source: ConfigSource = {
      name: 'slow',
      init: async () => {
        await Promise.resolve();
        order.push('init');
      },
      get: (key) => {
        order.push(`get:${key}`);

        return 'v';
      },
    };

    const reader = new ConfigReader([[source, '*']], { onWarn });
    await reader.init();
    reader.read('ANY');

    expect(order).toEqual(['init', 'get:ANY']);
  });

  it('close() закрывает каждый источник, объявивший его', async () => {
    const close = jest.fn((): void => undefined);
    const withClose: ConfigSource = { ...silent('a'), close };
    const withoutClose = silent('b');

    const reader = new ConfigReader(
      [
        [withClose, '*'],
        [withoutClose, '*'],
      ],
      { onWarn },
    );
    await reader.init();
    await reader.close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('предупреждения', () => {
  it('таргет, не покрывший ни одного объявленного ключа, виден на старте', async () => {
    registerSection(declaration('orders', ['ORDERS_URL']));

    const reader = new ConfigReader(
      [[objectSource({}, 'vault'), ['*_UR', '*_URL']]],
      { onWarn },
    );
    await reader.init();

    expect(warnings).toEqual([
      expect.stringContaining("source 'vault' targets '*_UR'"),
    ]);
  });

  it('уходят в подменённый канал, а не в console.warn', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(noop);

    try {
      const reader = new ConfigReader([[objectSource({}, 'v'), '*_NOPE']], {
        onWarn,
      });
      await reader.init();

      expect(warnings).toHaveLength(1);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('по умолчанию пишут в console.warn с префиксом пакета', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(noop);

    try {
      const reader = new ConfigReader([[objectSource({}, 'v'), '*_NOPE']]);
      await reader.init();

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[nestling/config]'),
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe('objectSource', () => {
  it('отдаёт значения и уведомляет наблюдателей на set/assign', () => {
    const source = objectSource({ A: '1' });
    const notified = jest.fn();
    source.watch?.(notified);

    expect(source.get('A')).toBe('1');
    expect(source.get('B')).toBeUndefined();

    source.set('B', '2');
    expect(source.get('B')).toBe('2');
    expect(notified).toHaveBeenCalledTimes(1);

    source.assign({ A: '9', C: '3' });
    expect(source.get('A')).toBe('9');
    expect(notified).toHaveBeenCalledTimes(2);
  });
});
