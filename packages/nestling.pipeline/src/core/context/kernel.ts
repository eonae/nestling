/**
 * Kernel-модуль ambient-контекста: один рецепт семейства ридеров.
 *
 * Корень регистрирует его **всегда** — как kernel-модуль конфига: иначе в
 * `assemble({ … })` пришлось бы писать про ambient-контекст, которого в
 * приложении может и не быть. «Всегда» ничего не стоит: члены семейства
 * создаются фикспоинтом по `deps`, поэтому без единого `Ctx(...)` в графе
 * не появляется ни одного узла.
 */

import { CtxFamily, makeCtxReader } from './reader.js';

import type { Module } from '@nestling/container';
import { familyProvider, valueProvider } from '@nestling/container';

/**
 * Собирает kernel-модуль ридеров ambient-контекста.
 *
 * @returns Модуль с единственным рецептом семейства `Ctx`
 *
 * @example
 * ```typescript
 * builder.register(contextKernel());
 * ```
 */
export const contextKernel = (): Module => ({
  name: 'kernel:context',
  providers: [
    familyProvider(CtxFamily, (key) =>
      valueProvider(CtxFamily(key), makeCtxReader(key)),
    ),
  ],
  exports: [CtxFamily],
});
