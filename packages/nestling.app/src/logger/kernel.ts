/**
 * Kernel-модуль логгера: рецепт семейства областей и члены ядра.
 *
 * Корень регистрирует его **всегда**. Корневого логгера здесь нет: он
 * живёт вне графа и создаётся раньше — на фазе 0, потому что ядро пишет
 * уже на ней, а первый узел появляется только на INIT.
 */

import type { ConfigReader } from '../config/index.js';
import { readSectionSnapshot } from '../config/index.js';

import type { LogConfig } from './config.js';
import { NESTLING_LOG_PREFIX } from './config.js';
import { ConsoleLogger } from './console.js';
import type { Logger } from './interface.js';
import { Logger$, RootLogger$ } from './tokens.js';

import type { Module } from '@nestling/container';
import { factoryProvider, familyProvider } from '@nestling/container';

/** Член семейства как дочерний логгер корня с привязкой области */
const memberOf = (scope: string) =>
  factoryProvider(Logger$(scope), (root: Logger) => root.child({ scope }), [
    RootLogger$,
  ]);

/**
 * Создаёт корневой логгер ядра: `ConsoleLogger` от снимка секции
 * `nestlingLog`.
 *
 * Зовётся на фазе 0, когда контейнера ещё нет: уровень и формат приходят
 * из снимка, а не из графа. Опция `logger` корня заменяет результат
 * целиком.
 *
 * @param reader - Читалка со снимком фазы 0
 * @returns Корневой логгер
 * @internal
 */
export const makeKernelLogger = (reader: ConfigReader): Logger =>
  new ConsoleLogger(
    readSectionSnapshot<LogConfig>(NESTLING_LOG_PREFIX, reader),
  );

/**
 * Собирает kernel-модуль логгера.
 *
 * Члены `Logger$('nestling')` и `Logger$('nestling:config')` зарегистрированы
 * явно: член семейства становится узлом, только когда его кто-то
 * запрашивает в `deps`, а ядру они нужны и тогда, когда прикладной код
 * логгер не инжектит.
 *
 * @example
 * ```typescript
 * builder.register(loggerKernel());
 * ```
 */
export const loggerKernel = (): Module => ({
  name: 'kernel:logger',
  providers: [
    familyProvider(Logger$, memberOf),
    memberOf('nestling'),
    memberOf('nestling:config'),
  ],
});
