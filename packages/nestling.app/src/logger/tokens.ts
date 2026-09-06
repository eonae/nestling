/**
 * DI-токены логгера: корень и семейство областей.
 *
 * Замена провайдера под `RootLogger$` меняет все члены `Logger$`: рецепт
 * семейства строит член как `root.child({ scope })`, и потребители членов
 * замены не видят.
 */

import type { Logger } from './interface.js';

import { makeToken, makeTokenFamily } from '@nestling/container';

/**
 * Корень логгера.
 *
 * Kernel-модуль объявляет под ним `ConsoleLogger` умолчанием; провайдер
 * приложения заменяет умолчание без ошибки дубля. Провайдер под этим
 * токеном не может зависеть от `Logger$(x)`: это цикл, и сборка назовёт
 * его путь.
 */
export const RootLogger$ = makeToken<Logger>('RootLogger');

/**
 * Семейство логгеров по области: `Logger$('users')` — дочерний логгер
 * корня с привязкой `scope: 'users'`. `Logger$.auto` даёт член по имени
 * класса-потребителя.
 *
 * Ядро пишет через `Logger$('nestling')` и области `nestling:<область>`.
 *
 * @example
 * ```typescript
 * @Injectable([Logger$.auto])
 * class OrdersService {
 *   constructor(private readonly logger: Logger) {}
 * }
 * ```
 */
export const Logger$ = makeTokenFamily<Logger, [scope: string]>('Logger');
