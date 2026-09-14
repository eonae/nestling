/**
 * Kernel-модуль метрик: писатели подключённых групп.
 *
 * Store регистрирует корень отдельным провайдером значения — так же, как
 * корневой логгер: провайдер приложения под ним обязан упасть ошибкой,
 * называющей владельца узла.
 *
 * Писатель заводится на каждую группу каталога. Группа, которую никто не
 * подключил вкладом `metrics:`, провайдера не получает, и запрос её в
 * `deps` падает отказом сборки с подсказкой самой группы.
 */

import type { AnyMetricsGroup } from './declaration.js';
import type { MetricsStore } from './store.js';
import { MetricsStore$ } from './store.js';
import { makeWriter } from './writer.js';

import type { Module } from '@nestlingjs/container';
import { factoryProvider } from '@nestlingjs/container';

/**
 * Собирает kernel-модуль метрик.
 *
 * @param groups - Группы каталога сборки
 *
 * @example
 * ```typescript
 * builder.register(metricsKernel(catalog.metrics.map(({ group }) => group)));
 * ```
 */
export const metricsKernel = (groups: readonly AnyMetricsGroup[]): Module => ({
  name: 'kernel:metrics',
  providers: [...new Set(groups)].map((group) =>
    factoryProvider(group, (store: MetricsStore) => makeWriter(group, store), [
      MetricsStore$,
    ]),
  ),
});
