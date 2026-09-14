/**
 * Зависимость источника от секции: очерёдность подъёма, проекция координат,
 * отказы по циклу и по непокрытой секции.
 */

import type { SpyLogger } from '../logger/__fixtures__/spy.js';
import { spyLogger } from '../logger/__fixtures__/spy.js';

import { objectSource } from './__fixtures__/object-source.js';
import type { ConfigSectionToken } from './declaration.js';
import { secret } from './declaration.js';
import {
  ConfigNeedsDeclarationError,
  ConfigSourceCycleError,
  ConfigSourceNeedsError,
} from './errors.js';
import type { Config } from './families.js';
import { bootstrapConfig } from './kernel.js';
import { ConfigKeys } from './keys.js';
import { describeConfig } from './registry.js';
import { makeConfig } from './section.js';
import type { ConfigSource } from './source.js';
import { bind } from './source.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const VaultConfig = makeConfig('vault', {
  addr: z.url(),
  token: secret(z.string()),
});

type VaultValues = Config<typeof VaultConfig>;

const MirrorConfig = makeConfig('mirror', { addr: z.url() });

const RelayConfig = makeConfig('relay', { addr: z.url() });

const OrdersConfig = makeConfig('orders', {
  maxItems: z.coerce.number().default(10),
});

const RotatingConfig = makeConfig.reloadable('rotating', { addr: z.url() });

/** Порядок подъёма источников этого теста */
let raised: string[] = [];

/** Шпион логгера: записи читалки уходят в него на `attachLogger` */
let spy: SpyLogger = spyLogger();

/** Источник, объявивший зависимость: пишет порядок и запоминает координаты */
interface NeedySource<T> extends ConfigSource<T> {
  /** Значения секции, полученные аргументом `init` */
  readonly seen: T[];
}

const needy = <T>(
  name: string,
  needs: ConfigSectionToken<T>,
  values: Readonly<Record<string, unknown>> = {},
): NeedySource<T> => {
  const seen: T[] = [];

  return {
    name,
    needs,
    seen,
    init: (received) => {
      raised.push(name);
      seen.push(received);
    },
    get: (key) => values[key],
  };
};

/** Источник без зависимостей: пишет порядок подъёма и отдаёт свои значения */
const plain = (
  name: string,
  values: Readonly<Record<string, unknown>> = {},
): ConfigSource => ({
  name,
  init: () => {
    raised.push(name);
  },
  get: (key) => values[key],
});

/** Координаты, которых нет ни в одном источнике этого прогона */
const coordinates = {
  VAULT_ADDR: 'https://vault.local',
  VAULT_TOKEN: 's3cr3t',
};

beforeEach(() => {
  raised = [];
  spy = spyLogger();
});

describe('очерёдность подъёма', () => {
  it('источник поднимается после того, кто покрывает его координаты', async () => {
    const vault = needy('vault', VaultConfig, { ORDERS_MAX_ITEMS: '99' });
    const env = plain('env', { ...coordinates, ORDERS_MAX_ITEMS: '1' });

    const reader = await bootstrapConfig([bind(vault), bind(env)]);

    // Порядок списка остался приоритетом разрешения ключа, а очерёдность
    // подъёма вывелась из `needs`: Vault выше `.env`, но поднят после него
    expect(raised).toEqual(['env', 'vault']);
    expect(reader.read('ORDERS_MAX_ITEMS')).toBe('99');
  });

  it('привязки без `needs` поднимаются в порядке списка', async () => {
    await bootstrapConfig([
      bind(plain('first')),
      bind(plain('second')),
      bind(plain('third')),
    ]);

    expect(raised).toEqual(['first', 'second', 'third']);
  });

  it('пишется в логгер ядра уровнем debug', async () => {
    const reader = await bootstrapConfig([
      bind(plain('first')),
      bind(plain('second')),
    ]);

    reader.attachLogger(spy.logger);

    expect(spy.entries).toContainEqual({
      level: 'debug',
      message: 'config sources are raised in this order: first, second',
      fields: {},
    });
  });
});

describe('цикл в `needs`', () => {
  it('взаимная зависимость двух источников отказывает до подъёма', async () => {
    const first = needy('first', VaultConfig);
    const second = needy('second', MirrorConfig);

    const error = await bootstrapConfig([bind(first), bind(second)]).catch(
      (error_: unknown) => error_,
    );

    expect(error).toBeInstanceOf(ConfigSourceCycleError);
    expect((error as ConfigSourceCycleError).chain).toEqual([
      'first',
      'second',
      'first',
    ]);
    expect(raised).toEqual([]);
  });

  it('цепочка из трёх источников названа целиком', async () => {
    const first = needy('first', VaultConfig);
    const second = needy('second', MirrorConfig);
    const third = needy('third', RelayConfig);

    const error = await bootstrapConfig([
      bind(first, { keys: RelayConfig.keys }),
      bind(second, { keys: VaultConfig.keys }),
      bind(third, { keys: MirrorConfig.keys }),
    ]).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(ConfigSourceCycleError);
    expect((error as ConfigSourceCycleError).chain).toEqual([
      'first',
      'second',
      'third',
      'first',
    ]);
  });

  it('`optional` цикл не проглатывает', async () => {
    const first = needy('first', VaultConfig);
    const second = needy('second', MirrorConfig);

    await expect(
      bootstrapConfig([
        bind(first, { optional: true }),
        bind(second, { optional: true }),
      ]),
    ).rejects.toBeInstanceOf(ConfigSourceCycleError);
  });
});

describe('проекция секции `needs`', () => {
  it('значения приходят в `init` проверенными схемами полей', async () => {
    const vault = needy('vault', VaultConfig);

    await bootstrapConfig([bind(vault), bind(plain('env', coordinates))]);

    expect(vault.seen).toEqual([
      { addr: 'https://vault.local', token: 's3cr3t' },
    ]);
  });

  it('источник, поднятый позже, координат не меняет', async () => {
    const vault = needy('vault', VaultConfig, {
      VAULT_ADDR: 'https://vault.internal',
    });

    const reader = await bootstrapConfig([
      bind(vault),
      bind(plain('env', coordinates)),
    ]);

    expect((vault.seen[0] as VaultValues).addr).toBe('https://vault.local');
    expect(reader.read('VAULT_ADDR')).toBe('https://vault.local');
  });

  it('привязка с глобом за свои координаты не отвечает', async () => {
    // Источник знает собственный адрес, но спрашивать его о нём некому:
    // иначе координаты Vault искались бы в самом Vault
    const vault = needy('vault', VaultConfig, {
      VAULT_ADDR: 'https://vault.internal',
      VAULT_TOKEN: 'from-vault',
    });

    const reader = await bootstrapConfig([
      bind(vault),
      bind(plain('env', coordinates)),
    ]);

    expect(reader.read('VAULT_TOKEN')).toBe('s3cr3t');
  });

  it('непокрытая секция отказывает с перечнем ключей', async () => {
    const init = vi.fn();
    const vault: ConfigSource<VaultValues> = {
      name: 'vault',
      needs: VaultConfig,
      init,
      // eslint-disable-next-line unicorn/no-useless-undefined
      get: () => undefined,
    };

    const error = await bootstrapConfig([
      bind(vault),
      bind(plain('env', { VAULT_TOKEN: 's3cr3t' })),
    ]).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(ConfigSourceNeedsError);

    const failure = error as ConfigSourceNeedsError;

    expect(failure.missing).toEqual(['VAULT_ADDR']);
    expect(failure.section).toBe('vault');
    expect(failure.sources).toEqual(['env']);
    expect(failure.message).toMatch(/VAULT_ADDR/);
    // Значение секретного поля в тексте отказа не появляется
    expect(failure.message).not.toMatch(/s3cr3t/);
    expect(init).not.toHaveBeenCalled();
  });

  it('`optional` пропускает источник без координат', async () => {
    const vault = needy('vault', VaultConfig);

    const reader = await bootstrapConfig([
      bind(vault, { optional: true }),
      bind(objectSource({ ORDERS_MAX_ITEMS: '7' }, 'env'), {
        keys: OrdersConfig.keys,
      }),
    ]);

    expect(reader.sources).toEqual(['env']);
    expect(reader.read('ORDERS_MAX_ITEMS')).toBe('7');
  });

  it('reloadable-секция в `needs` отказывает', async () => {
    const rotating = needy('rotating', RotatingConfig);

    const error = await bootstrapConfig([
      bind(rotating),
      bind(plain('env', { ROTATING_ADDR: 'https://rotating.local' })),
    ]).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(ConfigNeedsDeclarationError);
    expect((error as ConfigNeedsDeclarationError).fault).toBe('reloadable');
    expect((error as ConfigNeedsDeclarationError).message).toMatch(
      /'rotating'/,
    );
  });

  it('необъявленная секция отказывает, называя префикс', async () => {
    // DI-токен секции, чей модуль не импортирован: `.keys` есть, декларации
    // в реестре нет
    const detached = {
      id: 'config:absent',
      keys: new ConfigKeys('absent', ['ABSENT_ADDR']),
    } as ConfigSectionToken<{ addr: string }>;

    const source = needy('detached', detached);

    const error = await bootstrapConfig([bind(source)]).catch(
      (error_: unknown) => error_,
    );

    expect(error).toBeInstanceOf(ConfigNeedsDeclarationError);
    expect((error as ConfigNeedsDeclarationError).fault).toBe('undeclared');
    expect((error as ConfigNeedsDeclarationError).message).toMatch(/'absent'/);
  });

  it('секция координат считается потреблённой', async () => {
    const vault = needy('vault', VaultConfig);

    await bootstrapConfig([bind(vault), bind(plain('env', coordinates))]);

    const sections = describeConfig().sections;

    // Секцию прочитал источник, а не узел графа, но прочитана она
    // по-настоящему; секция, которую не читал никто, остаётся непотреблённой
    expect(
      sections.find((section) => section.prefix === 'vault')?.consumed,
    ).toBe(true);
    expect(
      sections.find((section) => section.prefix === 'orders')?.consumed,
    ).toBe(false);
  });
});
