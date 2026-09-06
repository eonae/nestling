/**
 * Kernel-модуль логгера: умолчание под корнем и рецепт семейства областей.
 *
 * Корень регистрирует его **всегда**. Умолчание объявлено полем `defaults`,
 * поэтому провайдер приложения под `RootLogger$` заменяет его без ошибки
 * дубля, в каком бы порядке модули ни регистрировались.
 */

import { ConsoleLogger } from './console.js';
import type { Logger } from './interface.js';
import { Logger$, RootLogger$ } from './tokens.js';

import type { Module } from '@nestling/container';
import {
  classProvider,
  factoryProvider,
  familyProvider,
} from '@nestling/container';

/** Член семейства как дочерний логгер корня с привязкой области */
const memberOf = (scope: string) =>
  factoryProvider(Logger$(scope), (root: Logger) => root.child({ scope }), [
    RootLogger$,
  ]);

/**
 * Собирает kernel-модуль логгера.
 *
 * Члены `Logger$('nestling')` и `Logger$('nestling:config')` зарегистрированы
 * явно: член семейства становится узлом, только когда его кто-то
 * запрашивает в `deps`, а сборка приложения — не узел графа и берёт эти
 * логгеры через `container.getOrThrow` после `build()`: первый — для своих
 * записей, второй — чтобы подключить его к читалке конфига.
 *
 * @example
 * ```typescript
 * builder.register(loggerKernel());
 * ```
 */
export const loggerKernel = (): Module => ({
  name: 'kernel:logger',
  defaults: [classProvider(RootLogger$, ConsoleLogger)],
  providers: [
    familyProvider(Logger$, memberOf),
    memberOf('nestling'),
    memberOf('nestling:config'),
  ],
});
