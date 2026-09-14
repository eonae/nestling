/**
 * Типовые тесты аргумента `vault(section)`.
 *
 * Файл не гоняется vitest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на проверке пакета.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { VaultConfig } from './config.js';
import { vault } from './source.js';

import type { ConfigSource } from '@nestlingjs/app';
import { makeConfig, secret } from '@nestlingjs/app';
import { z } from 'zod';

/** Готовая секция пакета подходит без оговорок */
const standard: ConfigSource<{
  addr: string;
  token: string;
  mount: string;
  path: string;
}> = vault(VaultConfig);

/** Приложение с двумя хранилищами объявляет свою секцию той же формы */
const BillingVault = makeConfig('billingVault', {
  addr: z.url(),
  token: secret(z.string()),
  mount: z.string().default('secret'),
  path: z.string(),
});

const billing = vault(BillingVault);

/** Секция без адреса не компилируется */
const Incomplete = makeConfig('incompleteVault', {
  token: secret(z.string()),
  mount: z.string().default('secret'),
  path: z.string(),
});

// @ts-expect-error секция не объявляет поля `addr`
const incomplete = vault(Incomplete);

/** Секция с лишними полями годится: источник читает только координаты */
const Extended = makeConfig('extendedVault', {
  addr: z.url(),
  token: secret(z.string()),
  mount: z.string().default('secret'),
  path: z.string(),
  namespace: z.string().default('root'),
});

const extended = vault(Extended);
