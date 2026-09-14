/**
 * Прогон против живого Vault: секрет пишется по HTTP API и читается
 * источником — тем же путём, каким его прочитает приложение.
 *
 * Без `TEST_VAULT_ADDR` каталог пропускается. Поднять сервер локально:
 * `yarn vault:up`.
 */

import { vault, VaultConfig } from '../src/index.js';

import {
  describeWithVault,
  TEST_VAULT_ADDR,
  TEST_VAULT_TOKEN,
  writeSecret,
} from './support.js';

import {
  bind,
  bootstrapConfig,
  env,
  makeConfig,
  secret,
} from '@nestlingjs/app';
import { beforeAll, expect, it } from 'vitest';
import { z } from 'zod';

const OrdersConfig = makeConfig('e2eOrders', {
  apiToken: secret(z.string()),
});

/** Координаты записанного секрета */
const coordinates = {
  addr: TEST_VAULT_ADDR,
  token: TEST_VAULT_TOKEN,
  mount: 'secret',
  path: 'nestling/orders',
};

describeWithVault('живой Vault', () => {
  beforeAll(async () => {
    await writeSecret('nestling/orders', {
      E2E_ORDERS_API_TOKEN: 'from-vault',
    });
  });

  it('источник читает записанный секрет', async () => {
    const source = vault(VaultConfig);

    await source.init?.(coordinates);

    expect(source.get('E2E_ORDERS_API_TOKEN')).toBe('from-vault');
  });

  it('ключ, которого в секрете нет, — «пропускаю ход»', async () => {
    const source = vault(VaultConfig);

    await source.init?.(coordinates);

    expect(source.get('E2E_ORDERS_MISSING')).toBeUndefined();
  });

  it('секрета по пути нет — отказ с путём', async () => {
    const source = vault(VaultConfig);

    await expect(
      source.init?.({ ...coordinates, path: 'nestling/absent' }),
    ).rejects.toThrow(/nestling\/absent/);
  });

  it('чужой токен — отказ прав', async () => {
    const source = vault(VaultConfig);

    await expect(
      source.init?.({ ...coordinates, token: 'not-a-token' }),
    ).rejects.toThrow(/40[13]/);
  });

  it('фаза 0 поднимает Vault по координатам из окружения', async () => {
    process.env.VAULT_ADDR = TEST_VAULT_ADDR;
    process.env.VAULT_TOKEN = TEST_VAULT_TOKEN;
    process.env.VAULT_MOUNT = 'secret';
    process.env.VAULT_PATH = 'nestling/orders';

    const reader = await bootstrapConfig([
      bind(vault(VaultConfig)),
      bind(env()),
    ]);

    // Ключ секции `e2eOrders` пришёл из Vault, а координаты самого Vault —
    // из окружения: список поднялся в порядке зависимостей
    expect(OrdersConfig.keys.names).toEqual(['E2E_ORDERS_API_TOKEN']);
    expect(reader.read('E2E_ORDERS_API_TOKEN')).toBe('from-vault');
    expect(reader.sources).toEqual(['vault(vault)', 'env']);
  });
});
