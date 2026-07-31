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
  // Тип обёртки `from()` виден снаружи не для ручного конструирования, а
  // потому что он попадает в выведенный тип секции: без него объявление
  // с `from()` нельзя было бы назвать в `.d.ts` потребителя.
  FromField,
  ReloadableConfig,
} from './declaration.js';
export { from } from './declaration.js';
export { ConfigValidationError } from './errors.js';
export type { ConfigFieldFailure } from './errors.js';
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
 * Примордиальное чтение секции — фаза 0: `select` считается до сборки, а
 * значит до читалки и привязанных источников.
 */
export { load } from './load.js';
export type { ConfigKernelOptions } from './kernel.js';
export type { ConfigWarn } from './reader.js';
export { describeConfig, keysGlob } from './registry.js';
export type {
  ConfigDescription,
  ConfigKeyDescription,
  ConfigSectionDescription,
} from './registry.js';
export { makeConfig } from './section.js';
export { objectSource } from './source.js';
export type { ConfigBinding, ConfigSource, ObjectSource } from './source.js';
