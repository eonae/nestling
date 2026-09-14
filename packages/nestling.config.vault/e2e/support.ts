/**
 * Общая обвязка тестов на работающем Vault.
 *
 * Адрес сервера приходит переменной `TEST_VAULT_ADDR`, корневой токен —
 * `TEST_VAULT_TOKEN`. Без адреса прогон пропускается: `yarn verify` на
 * машине без docker остаётся зелёным, а CI поднимает Vault сервисом и обе
 * переменные задаёт.
 *
 * Имена переменных свои, а не `VAULT_ADDR` и `VAULT_TOKEN`: прогон тестов
 * не должен зависеть от того, что лежит в окружении разработчика под
 * именами, которые читает боевая секция конфига.
 */

import { describe } from 'vitest';

/** Адрес сервера; без него тесты этого каталога пропускаются */
export const TEST_VAULT_ADDR = process.env.TEST_VAULT_ADDR ?? '';

/** Корневой токен dev-режима; тот же, что в `docker-compose.yml` */
export const TEST_VAULT_TOKEN = process.env.TEST_VAULT_TOKEN ?? 'nestling-root';

/** `describe`, который молчит без сервера */
export const describeWithVault: (title: string, suite: () => void) => void =
  TEST_VAULT_ADDR ? describe : describe.skip;

/**
 * Пишет секрет по HTTP API KV v2 — тем же путём, каким его пишет человек.
 *
 * @param path - Путь внутри точки монтирования `secret`
 * @param data - Рекорд секрета: имя ключа → значение
 */
export const writeSecret = async (
  path: string,
  data: Readonly<Record<string, string>>,
): Promise<void> => {
  const response = await fetch(`${TEST_VAULT_ADDR}/v1/secret/data/${path}`, {
    method: 'POST',
    headers: {
      'X-Vault-Token': TEST_VAULT_TOKEN,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ data }),
  });

  if (!response.ok) {
    throw new Error(
      `Writing test secret '${path}' answered ${response.status}: the server at ${TEST_VAULT_ADDR} is up but the token is not root.`,
    );
  }
};
