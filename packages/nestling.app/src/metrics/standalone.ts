/**
 * Писатель метрик ядра вне приложения.
 *
 * Рантайм пайплайна работает и без `App` — так его зовут тест слоя и
 * standalone-диспетчер транспорта. Писателя там взять негде, а
 * инструментовка условной не бывает, поэтому умолчание пишет в свой
 * store — ровно как запись логгера без `logger` уходит в логгер ядра.
 *
 * Ряды такого store заводятся по факту записи: состава деклараций у
 * standalone-пути нет, и предвычислять нечего.
 */

import { makeCatalog } from './catalog.js';
import type { KernelMetricsWriter } from './kernel-group.js';
import { KernelMetrics } from './kernel-group.js';
import { MetricsStore } from './store.js';
import { makeWriter } from './writer.js';

/** Store standalone-пути: создаётся при первой записи и живёт до конца процесса */
let standalone: KernelMetricsWriter | undefined;

/**
 * Писатель метрик ядра для пути без приложения.
 *
 * @returns Писателя группы ядра, пишущего в standalone-store
 */
export const defaultMetrics = (): KernelMetricsWriter =>
  (standalone ??= makeWriter(
    KernelMetrics,
    new MetricsStore(
      makeCatalog([{ group: KernelMetrics, owner: 'standalone runtime' }]),
    ),
  ));
