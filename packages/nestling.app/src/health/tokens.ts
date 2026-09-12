/**
 * DI-токены проб: узел и семейство вкладов.
 *
 * Оба публичны: узел берут адаптеры транспортов и тесты, семейство —
 * прикладной код, который регистрирует свою проверку.
 */

import type { Health, HealthCheck } from './interface.js';

import { makeToken, makeTokenFamily } from '@nestlingjs/container';

/**
 * Узел проб ядра.
 *
 * @example
 * ```typescript
 * @Handler([Health$])
 * class ReadyHandler {
 *   constructor(private readonly health: Health) {}
 *
 *   async handle(_: unknown, meta: { signal: AbortSignal }) {
 *     return new Ok(await this.health.readiness(meta.signal));
 *   }
 * }
 * ```
 */
export const Health$ = makeToken<Health>('Health');

/**
 * Семейство вкладов в пробы: `HealthCheck$('db')` — проверка базы.
 *
 * Параметр члена становится именем проверки в отчёте. Вклад регистрируется
 * обычным провайдером в том модуле, которому принадлежит; ничего кроме
 * этого объявлять не нужно. Вклады невыбранных фич отсутствуют в отчёте
 * тем же механизмом, который убирает из графа их провайдеры.
 *
 * @example
 * ```typescript
 * makeModule({
 *   name: 'module:db',
 *   providers: [classProvider(HealthCheck$('db'), DbHealthCheck)],
 * });
 * ```
 */
export const HealthCheck$ = makeTokenFamily<HealthCheck, [name: string]>(
  'HealthCheck',
);
