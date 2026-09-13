/**
 * Секция конфигурации проб: таймаут одной проверки и срок годности исходов.
 *
 * Секция читается узлом из графа обычной зависимостью: узел создаётся на
 * INIT, когда контейнер уже собран, — в отличие от логгера, которому
 * снимок фазы 0 нужен раньше графа.
 *
 * DI-токен секции наружу не экспортируется: граница ядра держится
 * видимостью ES-модулей, снаружи доступен только `.keys`.
 */

import { makeConfig } from '../config/index.js';

import { z } from 'zod';

/**
 * Секция конфигурации проб: `NESTLING_HEALTH_TIMEOUT` и
 * `NESTLING_HEALTH_CACHE`.
 *
 * Оба поля — неотрицательное целое число миллисекунд; приведение строки
 * нужно потому, что значение из окружения приходит строкой. Цепочка
 * написана здесь, а не взята билдером из `@nestlingjs/schema.zod`: тот
 * пакет зависит от этого, и обратная стрелка замкнула бы цикл.
 *
 * @internal Инжектится узлом проб; наружу отдаётся только `.keys`
 */
export const NestlingHealthConfig = makeConfig('nestlingHealth', {
  timeout: z.coerce.number().int().min(0).default(2000),
  cache: z.coerce.number().int().min(0).default(1000),
});

/** Ключи секции — то, что пакет отдаёт наружу для `config:` в корне */
export const healthConfigKeys = NestlingHealthConfig.keys;

/** Проекция секции проб */
export interface HealthConfig {
  /** Предел одной проверки, мс */
  readonly timeout: number;

  /** Срок годности исходов прогона, мс; `0` отключает кэш */
  readonly cache: number;
}
