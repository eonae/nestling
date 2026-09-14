/**
 * DI-токены логгера: корень и семейство областей.
 *
 * Замена провайдера под `RootLogger$` меняет все DI-токены `Logger$`: рецепт
 * семейства строит каждый как `root.child({ scope })`, и потребители
 * замены не видят.
 */

import type { Token, TokenFamily } from '@nestlingjs/container';
import { makeToken, makeTokenFamily } from '@nestlingjs/container';
import type { Logger } from '@nestlingjs/logging';

/**
 * Корень логгера.
 *
 * Значение регистрируется сборкой: логгер из опции `logging` корня или
 * штатный, и оба обёрнуты декоратором полей корреляции. Провайдер
 * приложения под этим DI-токеном — ошибка дубля: второго способа задать
 * корень нет.
 */
export const RootLogger$: Token<Logger> = makeToken<Logger>('RootLogger');

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
export const Logger$: TokenFamily<Logger, [scope: string]> = makeTokenFamily<
  Logger,
  [scope: string]
>('Logger');
