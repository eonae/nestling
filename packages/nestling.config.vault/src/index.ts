/**
 * `@nestlingjs/config.vault`: источник конфигурации поверх HashiCorp Vault.
 *
 * Барель перечисляет имена поимённо, а не через `export *`. Наружу выходят
 * источник, готовая секция координат и два типа — остальное остаётся
 * внутренним, и менять его можно без ломающей правки для тех, кто
 * установил пакет.
 */

// ./config.js — 2
export { VaultConfig } from './config.js';
export type { VaultCoordinates } from './config.js';

// ./source.js — 2
export { vault } from './source.js';
export type { VaultOptions } from './source.js';
