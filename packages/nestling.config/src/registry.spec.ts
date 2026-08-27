import type { SectionDeclaration } from './declaration.js';
import { ConfigKeys, deriveKey } from './keys.js';
import {
  declaredKeys,
  describeConfig,
  keysGlob,
  lookupSection,
  registerSection,
  resetConfigRegistry,
} from './registry.js';

const declaration = (
  prefix: string,
  fields: readonly (
    | string
    | { name: string; key?: string; secret?: boolean }
  )[],
  reloadable = false,
): SectionDeclaration => ({
  prefix,
  reloadable,
  fields: fields
    .map((field) => (typeof field === 'string' ? { name: field } : field))
    .map((field) => ({
      name: field.name,
      key: field.key ?? deriveKey(prefix, field.name),
      exact: field.key !== undefined,
      secret: field.secret ?? false,
      schema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: () => ({ value: 1 }),
        },
      },
    })),
  keys: new ConfigKeys(
    prefix,
    fields.map((field) =>
      typeof field === 'string'
        ? deriveKey(prefix, field)
        : (field.key ?? deriveKey(prefix, field.name)),
    ),
  ),
  consumed: false,
});

beforeEach(() => {
  resetConfigRegistry();
});

describe('реестр объявлений', () => {
  it('хранит декларацию под её префиксом', () => {
    const orders = declaration('orders', ['maxItems']);
    registerSection(orders);

    expect(lookupSection('orders')).toBe(orders);
  });

  it('повторная регистрация той же декларации — не ошибка', () => {
    const orders = declaration('orders', ['maxItems']);

    registerSection(orders);
    registerSection(orders);

    expect(describeConfig().sections).toHaveLength(1);
  });

  it('другая секция с тем же префиксом — ошибка, называющая обе', () => {
    registerSection(declaration('orders', ['maxItems']));

    expect(() => registerSection(declaration('orders', ['pageSize']))).toThrow(
      /prefix 'orders' is already declared.+\[maxItems].+\[pageSize]/s,
    );
  });

  it('отдаёт все объявленные ключи — против них сверяются привязки', () => {
    registerSection(declaration('orders', ['maxItems']));
    registerSection(declaration('users', ['pageSize']));

    expect(declaredKeys()).toEqual(['ORDERS_MAX_ITEMS', 'USERS_PAGE_SIZE']);
  });
});

describe('describeConfig()', () => {
  it('снимок несёт ключи и флаги и не несёт значений', () => {
    registerSection(declaration('runtime', ['logLevel'], true));

    const snapshot = describeConfig();

    expect(snapshot.sections).toEqual([
      {
        prefix: 'runtime',
        reloadable: true,
        consumed: false,
        keys: [
          {
            key: 'RUNTIME_LOG_LEVEL',
            field: 'logLevel',
            exact: false,
            secret: false,
          },
        ],
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('value');
  });

  it('различает потреблённую графом секцию и просто объявленную', () => {
    const orders = declaration('orders', ['maxItems']);
    registerSection(orders);
    registerSection(declaration('users', ['pageSize']));

    orders.consumed = true;

    expect(
      describeConfig().sections.map((section) => [
        section.prefix,
        section.consumed,
      ]),
    ).toEqual([
      ['orders', true],
      ['users', false],
    ]);
  });

  it('показывает объявленные unbound-глобы', () => {
    expect(keysGlob('*_GRPC_ADDRESS')).toBe('*_GRPC_ADDRESS');
    keysGlob('*_GRPC_ADDRESS');

    expect(describeConfig().globs).toEqual(['*_GRPC_ADDRESS']);
  });
});

/** Две секции на одном ключе: секретным его объявляет только `vault`. */
const declareSharedKey = (): void => {
  registerSection(
    declaration('vault', [
      { name: 'dbUrl', key: 'DATABASE_URL', secret: true },
    ]),
  );
  registerSection(
    declaration('orders', [{ name: 'databaseUrl', key: 'DATABASE_URL' }]),
  );
};

describe('эффективная секретность и индекс читателей', () => {
  it('секретность объединяется: флаг виден у обоих читателей ключа', () => {
    declareSharedKey();

    const secretFlags = describeConfig().sections.flatMap((section) =>
      section.keys.map((key) => [section.prefix, key.secret]),
    );

    expect(secretFlags).toEqual([
      ['vault', true],
      ['orders', true],
    ]);
  });

  it('индекс перечисляет всех объявленных читателей ключа', () => {
    declareSharedKey();

    expect(describeConfig().keys).toEqual([
      {
        key: 'DATABASE_URL',
        secret: true,
        readers: [
          {
            section: 'vault',
            field: 'dbUrl',
            exact: true,
            reloadable: false,
            secret: true,
          },
          {
            section: 'orders',
            field: 'databaseUrl',
            exact: true,
            reloadable: false,
            secret: false,
          },
        ],
      },
    ]);
  });

  it('читатель остаётся в индексе, даже если секция не потреблена', () => {
    declareSharedKey();

    const [entry] = describeConfig().keys;

    expect(
      describeConfig().sections.every((section) => !section.consumed),
    ).toBe(true);
    expect(entry?.readers).toHaveLength(2);
  });

  it('ключ с единственным читателем тоже в индексе', () => {
    registerSection(declaration('orders', ['maxItems']));

    expect(describeConfig().keys).toEqual([
      {
        key: 'ORDERS_MAX_ITEMS',
        secret: false,
        readers: [
          {
            section: 'orders',
            field: 'maxItems',
            exact: false,
            reloadable: false,
            secret: false,
          },
        ],
      },
    ]);
  });

  it('непомеченный никем ключ не становится секретным сам', () => {
    registerSection(declaration('orders', ['maxItems']));

    expect(describeConfig().keys[0]?.secret).toBe(false);
  });

  it('значений в снимке нет — ни секретных, ни обычных', () => {
    declareSharedKey();

    expect(JSON.stringify(describeConfig())).not.toContain('value');
  });

  it('сброс реестра чистит и индекс, и множество секретных ключей', () => {
    declareSharedKey();
    resetConfigRegistry();
    registerSection(
      declaration('orders', [{ name: 'databaseUrl', key: 'DATABASE_URL' }]),
    );

    expect(describeConfig().keys).toEqual([
      {
        key: 'DATABASE_URL',
        secret: false,
        readers: [
          {
            section: 'orders',
            field: 'databaseUrl',
            exact: true,
            reloadable: false,
            secret: false,
          },
        ],
      },
    ]);
  });
});
