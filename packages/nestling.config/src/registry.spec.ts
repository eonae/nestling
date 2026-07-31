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
  fields: readonly string[],
  reloadable = false,
): SectionDeclaration => ({
  prefix,
  reloadable,
  fields: fields.map((name) => ({
    name,
    key: deriveKey(prefix, name),
    exact: false,
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
    fields.map((name) => deriveKey(prefix, name)),
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
        keys: [{ key: 'RUNTIME_LOG_LEVEL', field: 'logLevel', exact: false }],
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
