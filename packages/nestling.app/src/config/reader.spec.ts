import type { SpyLogger } from '../logger/__fixtures__/spy.js';
import { spyLogger } from '../logger/__fixtures__/spy.js';

import type { SectionDeclaration } from './declaration.js';
import { ConfigSourceError } from './errors.js';
import { ConfigKeys } from './keys.js';
import { ConfigReader } from './reader.js';
import { registerSection, resetConfigRegistry } from './registry.js';
import type { ConfigSource } from './source.js';
import { env, objectSource } from './source.js';

import { jest } from '@jest/globals';

const schema = {
  '~standard': { version: 1, vendor: 'test', validate: () => ({ value: 1 }) },
} as const;

const declaration = (prefix: string, keys: readonly string[]) =>
  ({
    prefix,
    reloadable: false,
    fields: keys.map((key) => ({
      name: key,
      key,
      exact: true,
      schema,
      secret: false,
    })),
    derived: [],
    keys: new ConfigKeys(prefix, keys),
    consumed: false,
  }) satisfies SectionDeclaration;

/** Шпион логгера: предупреждения читалки попадают сюда после `attachLogger` */
let spy: SpyLogger = spyLogger();

/** Сообщения предупреждений в порядке записи */
const warnings = (): string[] => spy.entries.map((entry) => entry.message);

/** Источник, который никогда ничего не знает — «пропускаю ход» на любой ключ. */
const silent = (name: string): ConfigSource => ({
  name,
  // eslint-disable-next-line unicorn/no-useless-undefined
  get: () => undefined,
});

beforeEach(() => {
  resetConfigRegistry();
  spy = spyLogger();
  delete process.env.ORDERS_MAX_ITEMS;
  delete process.env.SERVICE_1_ORDERS_MAX_ITEMS;
  delete process.env.DATABASE_URL;
  delete process.env.SERVICE_1_DATABASE_URL;
});

describe('разрешение ключа', () => {
  it('порядок привязок задаёт приоритет', async () => {
    const first = objectSource({ ORDERS_MAX_ITEMS: 'first' }, 'first');
    const second = objectSource({ ORDERS_MAX_ITEMS: 'second' }, 'second');

    const reader = new ConfigReader([
      [first, '*'],
      [second, '*'],
    ]);
    await reader.init();

    expect(reader.read('ORDERS_MAX_ITEMS')).toBe('first');
  });

  it('провал до env, а без env — undefined', async () => {
    process.env.ORDERS_MAX_ITEMS = 'from-env';

    const empty = objectSource({}, 'empty');
    const reader = new ConfigReader([[empty, '*']]);
    await reader.init();

    expect(reader.read('ORDERS_MAX_ITEMS')).toBe('from-env');
    expect(reader.read('NOT_SET_ANYWHERE')).toBeUndefined();
  });

  it('без привязок читает только process.env', async () => {
    process.env.ORDERS_MAX_ITEMS = 'bare-env';

    const reader = new ConfigReader();
    await reader.init();

    expect(reader.read('ORDERS_MAX_ITEMS')).toBe('bare-env');
  });

  it('источник не опрашивается для ключей вне его таргета', async () => {
    const get = jest.fn(() => 'x');
    const scoped: ConfigSource = { name: 'scoped', get };

    const reader = new ConfigReader([
      [scoped, new ConfigKeys('orders', ['ORDERS_MAX_ITEMS'])],
    ]);
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

    const reader = new ConfigReader([
      [objectSource({}, 'vault'), '*'],
      [anonymous, '*'],
    ]);

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

    const reader = new ConfigReader([[source, '*']]);
    await reader.init();
    reader.read('ANY');

    expect(order).toEqual(['init', 'get:ANY']);
  });

  it('close() закрывает каждый источник, объявивший его', async () => {
    const close = jest.fn((): void => undefined);
    const withClose: ConfigSource = { ...silent('a'), close };
    const withoutClose = silent('b');

    const reader = new ConfigReader([
      [withClose, '*'],
      [withoutClose, '*'],
    ]);
    await reader.init();
    await reader.close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('снимок фазы 0', () => {
  it('init() читает объявленные ключи, чтение источник не трогает', async () => {
    registerSection(declaration('orders', ['ORDERS_MAX_ITEMS']));

    const get = jest.fn(() => '10');
    const source: ConfigSource = { name: 'snapshot', get };

    const reader = new ConfigReader([[source, '*']]);
    await reader.init();

    expect(get).toHaveBeenCalledTimes(1);

    expect(reader.read('ORDERS_MAX_ITEMS')).toBe('10');
    expect(reader.read('ORDERS_MAX_ITEMS')).toBe('10');

    // Значение пришло из снимка: источник опрошен всё тем же один раз
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('значение снимка не меняется вслед за источником', async () => {
    registerSection(declaration('orders', ['ORDERS_MAX_ITEMS']));

    const source = objectSource({ ORDERS_MAX_ITEMS: '10' }, 'snapshot');
    const reader = new ConfigReader([[source, '*']]);
    await reader.init();

    source.set('ORDERS_MAX_ITEMS', '20');

    expect(reader.read('ORDERS_MAX_ITEMS')).toBe('10');
  });

  it('ключ вне реестра читается по промаху и запоминается', async () => {
    const get = jest.fn(() => 'localhost:50051');
    const source: ConfigSource = { name: 'globs', get };

    const reader = new ConfigReader([[source, '*']]);
    await reader.init();

    // Реестр пуст, значит снимок тоже: первое чтение идёт к источнику
    expect(get).not.toHaveBeenCalled();

    expect(reader.read('ORDERS_GRPC_ADDRESS')).toBe('localhost:50051');
    expect(reader.read('ORDERS_GRPC_ADDRESS')).toBe('localhost:50051');

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('отказ init() называет источник и несёт исходную ошибку', async () => {
    const cause = new Error('connection refused');
    const failing: ConfigSource = {
      ...silent('vault'),
      init: () => {
        throw cause;
      },
    };

    const reader = new ConfigReader([[failing, '*']]);
    const error = await reader.init().catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(ConfigSourceError);
    expect((error as ConfigSourceError).source).toBe('vault');
    expect((error as ConfigSourceError).cause).toBe(cause);
    expect((error as ConfigSourceError).message).toMatch(/'vault'/);
  });

  it('init() источника вызывается один раз: повторы — дело источника', async () => {
    const init = jest.fn(async () => {
      await Promise.reject(new Error('temporarily unavailable'));
    });
    const flaky: ConfigSource = { ...silent('flaky'), init };

    const reader = new ConfigReader([[flaky, '*']]);

    await expect(reader.init()).rejects.toThrow(/Config source 'flaky'/);
    expect(init).toHaveBeenCalledTimes(1);
  });
});

describe('предупреждения', () => {
  it('таргет, не покрывший ни одного объявленного ключа, виден на старте', async () => {
    registerSection(declaration('orders', ['ORDERS_URL']));

    const reader = new ConfigReader([
      [objectSource({}, 'vault'), ['*_UR', '*_URL']],
    ]);
    await reader.init();
    reader.attachLogger(spy.logger);

    expect(warnings()).toEqual([
      expect.stringContaining("source 'vault' targets '*_UR'"),
    ]);
  });

  it('копятся до подключения логгера и уходят в него разом', async () => {
    const reader = new ConfigReader([[objectSource({}, 'v'), '*_NOPE']]);
    await reader.init();

    expect(spy.entries).toEqual([]);

    reader.attachLogger(spy.logger);

    expect(spy.entries).toEqual([
      {
        level: 'warn',
        message: expect.stringContaining("targets '*_NOPE'"),
        fields: {},
      },
    ]);

    // Буфер отдан один раз: повторное подключение ничего не повторяет
    const another = spyLogger();
    reader.attachLogger(another.logger);

    expect(another.entries).toEqual([]);
  });

  it('после подключения идут в логгер напрямую', async () => {
    const reader = new ConfigReader([]);
    await reader.init();
    reader.attachLogger(spy.logger);

    reader.warn('late');

    expect(warnings()).toEqual(['late']);
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

describe('env({ prefix })', () => {
  /** Один `.env` на два сервиса: приставка перекрывает неявный `process.env` */
  it('значение под приставкой выигрывает у общего', async () => {
    process.env.ORDERS_MAX_ITEMS = 'shared';
    process.env.SERVICE_1_ORDERS_MAX_ITEMS = 'mine';

    registerSection(declaration('orders', ['ORDERS_MAX_ITEMS']));

    const reader = new ConfigReader([[env({ prefix: 'SERVICE_1_' }), '*']]);
    await reader.init();

    expect(reader.read('ORDERS_MAX_ITEMS')).toBe('mine');
  });

  it('ключ без приставки читается неявным `process.env`', async () => {
    process.env.DATABASE_URL = 'postgresql://shared';

    registerSection(declaration('orders', ['DATABASE_URL']));

    const reader = new ConfigReader([[env({ prefix: 'SERVICE_1_' }), '*']]);
    await reader.init();

    expect(reader.read('DATABASE_URL')).toBe('postgresql://shared');
  });

  it('имена ключей секции приставка не меняет', () => {
    const section = declaration('orders', ['ORDERS_MAX_ITEMS']);

    registerSection(section);

    expect(section.keys.names).toEqual(['ORDERS_MAX_ITEMS']);
  });

  it('без приставки читает имя ключа как есть', () => {
    process.env.ORDERS_MAX_ITEMS = 'plain';

    expect(env().get('ORDERS_MAX_ITEMS')).toBe('plain');
  });

  it('источник не объявляет ни init, ни watch, ни close', () => {
    const source = env({ prefix: 'SERVICE_1_' });

    expect(source.init).toBeUndefined();
    expect(source.watch).toBeUndefined();
    expect(source.close).toBeUndefined();
    expect(source.name).toBe('env(SERVICE_1_*)');
  });

  it('приставка попадает в перечень опрошенных источников', () => {
    const reader = new ConfigReader([[env({ prefix: 'SERVICE_1_' }), '*']]);

    expect(reader.sources).toEqual(['env(SERVICE_1_*)', 'process.env']);
  });
});
