import { from } from './declaration.js';
import type { Config } from './families.js';
import { ConfigKeys } from './keys.js';
import { describeConfig } from './registry.js';
import { makeConfig } from './section.js';

import type { InjectionToken } from '@nestling/container';
import { stringifyToken } from '@nestling/container';
import { z } from 'zod';

/** Тип-утверждение: ложный `Equal<…>` не проходит компиляцию. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const assertType = <T extends true>(assertion: T): T => assertion;

const OrdersConfig = makeConfig('orders', {
  maxItems: z.coerce.number().default(100),
  httpURL: z.string(),
  databaseUrl: from('DATABASE_URL', z.string()),
});

describe('форма секции — рекорд полей', () => {
  it('ключи выводятся из префикса, `from()` задаёт точное имя', () => {
    expect(OrdersConfig.keys.names).toEqual([
      'ORDERS_MAX_ITEMS',
      'ORDERS_HTTP_URL',
      'DATABASE_URL',
    ]);
  });

  it('лист — любая реализация Standard Schema v1', () => {
    const Foreign = makeConfig('foreign', {
      value: {
        '~standard': {
          version: 1,
          vendor: 'not-zod',
          validate: (input: unknown) => ({ value: String(input) }),
        },
      },
    });

    expect(Foreign.keys.names).toEqual(['FOREIGN_VALUE']);
  });

  it('объект, не реализующий спеку, отвергается с именем секции и поля', () => {
    expect(() =>
      makeConfig('broken', { maxItems: { parse: () => 1 } as never }),
    ).toThrow(/Field 'maxItems' of config section 'broken'/);
  });

  it('секция попадает в реестр как объявленная, но не потреблённая', () => {
    const section = describeConfig().sections.find(
      (item) => item.prefix === 'orders',
    );

    expect(section).toMatchObject({
      prefix: 'orders',
      reloadable: false,
      consumed: false,
    });
    expect(section?.keys).toEqual([
      { key: 'ORDERS_MAX_ITEMS', field: 'maxItems', exact: false },
      { key: 'ORDERS_HTTP_URL', field: 'httpURL', exact: false },
      { key: 'DATABASE_URL', field: 'databaseUrl', exact: true },
    ]);
  });
});

describe('токен секции', () => {
  it('строковый id — член семейства ConfigSection', () => {
    expect(stringifyToken(OrdersConfig)).toBe('ConfigSection:orders');
  });

  it('не инстанцируется: конструктор называет причину и способ починки', () => {
    expect(() => new OrdersConfig()).toThrow(
      /Config section 'orders' is not instantiable/,
    );
  });

  it('`.keys` — хэндл, а не токен', () => {
    expect(OrdersConfig.keys).toBeInstanceOf(ConfigKeys);
    expect(OrdersConfig.keys.prefix).toBe('orders');
  });

  it('reloadable-секция с полем `onChange` отвергается на объявлении', () => {
    expect(() =>
      makeConfig.reloadable('collides', { onChange: z.string() }),
    ).toThrow(/'onChange'/);
  });
});

describe('типы проекции', () => {
  it('поле типизировано выходом своей схемы, `from()` прозрачен', () => {
    type Values = Config<typeof OrdersConfig>;

    assertType<Equal<Values['maxItems'], number>>(true);
    assertType<Equal<Values['httpURL'], string>>(true);
    assertType<Equal<Values['databaseUrl'], string>>(true);
  });

  it('обращение к несуществующему полю — ошибка компиляции', () => {
    type Values = Config<typeof OrdersConfig>;
    const read = (cfg: Values): unknown =>
      // @ts-expect-error — поля `nope` в секции нет
      cfg.nope;

    expect(typeof read).toBe('function');
  });

  it('`.keys` нельзя поставить в `deps` — это не InjectionToken', () => {
    // @ts-expect-error — хэндл ключей не является InjectionToken
    const deps: InjectionToken[] = [OrdersConfig.keys];

    expect(deps).toHaveLength(1);
  });

  it('обычная секция не имеет `onChange` ни в типах, ни в рантайме', () => {
    type Values = Config<typeof OrdersConfig>;
    const subscribe = (cfg: Values): unknown =>
      // @ts-expect-error — `onChange` есть только у reloadable-секции
      cfg.onChange;

    expect(typeof subscribe).toBe('function');
  });
});
