/**
 * Публичная поверхность ambient-контекста.
 *
 * Наружу уезжают объявление переменной, ридер и kernel-модуль. Машинерия
 * проекции (ячейка, ALS-хранилище, писатель) и само семейство `Ctx`
 * остаются внутренностями пакета: единственная дверь наружу —
 * `runInRequestScope` для прямого пути транспорта, и она помечена
 * `@internal`.
 */

export { contextKernel } from './kernel.js';
export type { CtxReader } from './reader.js';
export { Ctx, ContextVarUnavailableError } from './reader.js';
export { runInRequestScope } from './store.js';
export type {
  AnyContextVar,
  ContextVar,
  ReadonlyContextVar,
} from './variable.js';
export { contextVar } from './variable.js';
export { RequestId, Signal } from './well-known.js';
