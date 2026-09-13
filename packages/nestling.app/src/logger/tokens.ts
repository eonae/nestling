/**
 * DI-токены логгера: корень и семейство областей.
 *
 * Замена провайдера под `RootLogger$` меняет все DI-токены `Logger$`: рецепт
 * семейства строит каждый как `root.child({ scope })`, и потребители
 * замены не видят.
 */

import type { Logger } from './interface.js';

import { makeToken, makeTokenFamily } from '@nestlingjs/container';

/**
 * Корень логгера.
 *
 * Kernel-модуль объявляет под ним `ConsoleLogger` умолчанием; провайдер
 * приложения заменяет умолчание без ошибки дубля. Провайдер под этим
 * DI-токеном не может зависеть от `Logger$(x)`: это цикл, и сборка назовёт
 * его путь.
 */
export const RootLogger$ = makeToken<Logger>('RootLogger');

/**
 * Семейство логгеров по области: `Logger$('users')` — дочерний логгер
 * корня с привязкой `scope: 'users'`. `Logger$.auto` даёт токен семейства по имени
 * класса-потребителя.
 *
 * Ядро пишет через `Logger$('nestling')` и области `nestling:<область>`.
 *
 * @example
 * ```typescript
 * @Component([Logger$.auto])
 * class OrdersService {
 *   constructor(private readonly logger: Logger) {}
 * }
 * ```
 */
export const Logger$ = makeTokenFamily<Logger, [scope: string]>('Logger');
