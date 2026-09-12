/**
 * DI-токены метрик: корень и семейство областей.
 *
 * Замена значения под `RootMetrics$` меняет все члены `Metrics$`: рецепт
 * семейства оборачивает корень, добавляя атрибут `scope`, и потребители
 * членов замены не видят.
 */

import type { Metrics } from './interface.js';

import { makeToken, makeTokenFamily } from '@nestlingjs/container';

/**
 * Корень метрик.
 *
 * Значение задаёт опция `makeApp({ metrics })`; без неё под DI-токеном
 * стоит пустая реализация. Провайдер приложения под ним — ошибка дубля:
 * иначе оставался бы вопрос, чью запись видит инструментовка ядра.
 */
export const RootMetrics$ = makeToken<Metrics>('RootMetrics');

/**
 * Семейство метрик по области: `Metrics$('users')` добавляет к каждой
 * записи атрибут `scope: 'users'`. `Metrics$.auto` даёт член по имени
 * класса-потребителя.
 *
 * @example
 * ```typescript
 * @Component([Metrics$.auto])
 * class OrdersService {
 *   constructor(private readonly metrics: Metrics) {}
 * }
 * ```
 */
export const Metrics$ = makeTokenFamily<Metrics, [scope: string]>('Metrics');
