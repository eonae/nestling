/**
 * Kernel-модуль метрик: рецепт семейства областей.
 *
 * Корень регистрирует его **всегда**, как kernel-модуль логгера. Цена
 * «всегда» нулевая: токен семейства становится узлом только тогда, когда
 * его кто-то запросил в `deps`. Самого корня здесь нет — его значение
 * приходит опцией корня и регистрируется провайдером значения.
 */

import type { MetricAttributes, Metrics } from './interface.js';
import { Metrics$, RootMetrics$ } from './tokens.js';

import type { Module } from '@nestlingjs/container';
import { factoryProvider, familyProvider } from '@nestlingjs/container';

/**
 * Оборачивает корень областью: к каждой записи добавляется `scope`.
 *
 * Обёртка живёт здесь, а не в интерфейсе: метода `child` у `Metrics` нет,
 * поэтому адаптеру не приходится его реализовывать.
 */
const scoped = (root: Metrics, scope: string): Metrics => ({
  counter: (name: string, value?: number, attributes?: MetricAttributes) =>
    root.counter(name, value, { ...attributes, scope }),

  histogram: (name: string, value: number, attributes?: MetricAttributes) =>
    root.histogram(name, value, { ...attributes, scope }),
});

/** Токен семейства как корень с привязанной областью */
const memberOf = (scope: string) =>
  factoryProvider(Metrics$(scope), (root: Metrics) => scoped(root, scope), [
    RootMetrics$,
  ]);

/**
 * Собирает kernel-модуль метрик.
 *
 * @example
 * ```typescript
 * builder.register(metricsKernel());
 * ```
 */
export const metricsKernel = (): Module => ({
  name: 'kernel:metrics',
  providers: [familyProvider(Metrics$, memberOf)],
});
