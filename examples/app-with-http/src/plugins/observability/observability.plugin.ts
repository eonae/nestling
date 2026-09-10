import { AuditOutcome } from './observability.js';

import type { Plugin } from '@nestlingjs/app';
import { makePlugin } from '@nestlingjs/app';

/**
 * Плагин наблюдаемости: класс-юнит слоя `observability`.
 *
 * Плагин — сквозная инфраструктура: он есть в каждом процессе. Логгер ему
 * не нужен: логгер даёт ядро, а уровень и формат задают
 * `NESTLING_LOG_LEVEL` и `NESTLING_LOG_FORMAT`. Параметров у плагина нет,
 * поэтому значение одно и объявлено здесь.
 */
export const appObservability: Plugin = makePlugin({
  name: 'app-observability',
  // Класс-юнит слоя `observability`: без регистрации слой не соберётся
  providers: [AuditOutcome],
});
