/**
 * Секция координат хранилища и её форма.
 *
 * Секция передаётся источнику аргументом, а не берётся им из себя: связь
 * «источник ↔ его координаты» видна в строке вызова. `VaultConfig` —
 * готовая секция на обычный случай; приложение с двумя хранилищами
 * объявляет свою секцию любой формы, подходящей под {@link VaultCoordinates}.
 */

import type { ConfigSectionToken } from '@nestlingjs/app';
import { makeConfig, secret } from '@nestlingjs/app';
import { z } from 'zod';

/**
 * Значения, которые источник берёт из секции.
 *
 * Тип ограничивает аргумент {@link vault}: секция без адреса или без пути
 * не компилируется, а секция с лишними полями годится — источник читает
 * только эти четыре.
 */
export interface VaultCoordinates {
  /** Адрес сервера: `https://vault.internal:8200` */
  readonly addr: string;
  /** Токен доступа; уходит заголовком `X-Vault-Token` */
  readonly token: string;
  /** Точка монтирования движка KV v2 */
  readonly mount: string;
  /** Путь секрета внутри точки монтирования */
  readonly path: string;
}

/**
 * Секция координат: `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_MOUNT`, `VAULT_PATH`.
 *
 * Токен объявлен `secret()`, поэтому его значение не попадает ни в снимок
 * реестра, ни в диагностику. Точка монтирования по умолчанию — `secret`,
 * то есть движок KV, который Vault поднимает сам.
 *
 * @example
 * ```typescript
 * await app.build().run({
 *   config: [bind(vault(VaultConfig)), ...defaultSources],
 * });
 * ```
 */
export const VaultConfig: ConfigSectionToken<VaultCoordinates, 'vault'> =
  makeConfig('vault', {
    addr: z.url(),
    token: secret(z.string()),
    mount: z.string().default('secret'),
    path: z.string(),
  });
