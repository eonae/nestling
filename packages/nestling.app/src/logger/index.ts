/**
 * Логгер ядра: DI-токены, поля корреляции, ключи секции и kernel-модуль.
 *
 * Интерфейс и штатная реализация живут в `@nestlingjs/logging`: сателлиту
 * логирования нужен интерфейс, а не ядро. Секция, декоратор полей и
 * умолчание standalone-путей наружу не идут — реализации ядра приватны,
 * как у конфига и портов.
 */

export { logConfigKeys } from './config.js';
export type { LogFieldsPlan } from './decorator.js';
export { withLogFields } from './decorator.js';
export type { LogField, LogFieldSpec, ResolvedLogField } from './fields.js';
export {
  collectLogFields,
  DEFAULT_LOG_FIELDS,
  logField,
  ROOT_FIELDS_OWNER,
} from './fields.js';
export { loggerKernel, makeKernelLogger } from './kernel.js';
export { Logger$, RootLogger$ } from './tokens.js';
