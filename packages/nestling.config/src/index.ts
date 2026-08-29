/**
 * `@nestling/config` — конфигурация поверх token families.
 *
 * Экспорт намеренно узкий. Читалка (`ConfigReader`) и её токен здесь
 * отсутствуют: kernel-граница держится видимостью ES-модулей, а не
 * рантайм-проверками. Семейство `ConfigSection` тоже приватно — секция
 * инжектится своим собственным токеном.
 */

export type {
  ConfigField,
  ConfigRecord,
  ConfigSectionToken,
  ConfigValues,
  // Типы обёрток `from()` и `secret()` видны снаружи не для ручного
  // конструирования, а потому что попадают в выведенный тип секции: без них
  // объявление с обёрткой нельзя было бы назвать в `.d.ts` потребителя.
  FromField,
  ReloadableConfig,
  SecretField,
} from './declaration.js';
export { from, secret } from './declaration.js';
export { ConfigSharedKeyError, ConfigValidationError } from './errors.js';
export type { ConfigFieldFailure, SharedKeyReader } from './errors.js';
/**
 * `Config` — и семейство одиночных ключей (значение), и тип проекции
 * секции (`Config<typeof OrdersConfig>`). Обе формы взяты из design-дока.
 */
export { Config } from './families.js';
export type { Config as ConfigProjection } from './families.js';
export { ConfigKeys } from './keys.js';
export type { ConfigGlob, ConfigTarget } from './keys.js';
export { configKernel } from './kernel.js';
/**
 * Первичное чтение секции — фаза 0: `select` считается до сборки, а
 * значит до читалки и привязанных источников.
 */
export { load } from './load.js';
export type { ConfigKernelOptions } from './kernel.js';
export type { ConfigWarn } from './reader.js';
export { describeConfig, keysGlob } from './registry.js';
export type {
  ConfigDescription,
  ConfigKeyDescription,
  ConfigKeyReader,
  ConfigSectionDescription,
  ConfigSharedKeyDescription,
} from './registry.js';
export { makeConfig } from './section.js';
export { objectSource } from './source.js';
export type { ConfigBinding, ConfigSource, ObjectSource } from './source.js';
