/**
 * Слой конфигурации: секции поверх token families.
 *
 * Экспорт намеренно узкий. Класс читалки и её токен здесь отсутствуют:
 * kernel-граница держится видимостью ES-модулей, а не рантайм-проверками —
 * наружу выходит только тип `ConfigReader`, чтобы назвать результат фазы 0.
 * Семейство `ConfigSection` тоже приватно — секция инжектится своим
 * собственным токеном.
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
export {
  ConfigSharedKeyError,
  ConfigSourceError,
  ConfigValidationError,
} from './errors.js';
export type { ConfigFieldFailure, SharedKeyReader } from './errors.js';
/**
 * `Config` — и семейство одиночных ключей (значение), и тип проекции
 * секции (`Config<typeof OrdersConfig>`). Обе формы взяты из design-дока.
 */
export { Config } from './families.js';
export type { Config as ConfigProjection } from './families.js';
export { ConfigKeys } from './keys.js';
export type { ConfigGlob, ConfigTarget } from './keys.js';
/**
 * Фаза 0 конфига: `bootstrapConfig` поднимает источники вне контейнера,
 * `configKernel` вносит готовую читалку в граф значением.
 */
export { bootstrapConfig, configKernel } from './kernel.js';
/**
 * Читалка — результат фазы 0, только как тип.
 *
 * Конструктора наружу нет, DI-токена тоже: читалку нельзя ни создать, ни
 * инжектить. Имя нужно, чтобы назвать значение, которое отдаёт
 * `bootstrapConfig` и принимает `configKernel`.
 */
export type { ConfigReader } from './kernel.js';
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
export { objectSource, toBindings } from './source.js';
export type {
  ConfigBinding,
  ConfigInput,
  ConfigSource,
  ObjectSource,
} from './source.js';
