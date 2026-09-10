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

import type { StandardSchemaV1 } from '@nestlingjs/common.misc';

/**
 * Схема неотрицательного целого числа миллисекунд с умолчанием.
 *
 * Написана руками по тому же приёму, что схемы секций логгера и портов:
 * Standard Schema это интерфейс, а не библиотека, и ядру не нужен вендор,
 * чтобы проверить одно число.
 */
const milliseconds = (fallback: number): StandardSchemaV1<unknown, number> => ({
  '~standard': {
    version: 1,
    vendor: 'nestling',
    validate: (value) => {
      if (value === undefined || value === null || value === '') {
        return { value: fallback };
      }

      const parsed = typeof value === 'number' ? value : Number(value);

      return Number.isInteger(parsed) && parsed >= 0
        ? { value: parsed }
        : {
            issues: [
              {
                message:
                  `Expected a non-negative integer number of milliseconds, ` +
                  `got ${JSON.stringify(value)}`,
              },
            ],
          };
    },
  },
});

/**
 * Секция конфигурации проб: `NESTLING_HEALTH_TIMEOUT` и
 * `NESTLING_HEALTH_CACHE`.
 *
 * @internal Инжектится узлом проб; наружу отдаётся только `.keys`
 */
export const NestlingHealthConfig = makeConfig('nestlingHealth', {
  timeout: milliseconds(2000),
  cache: milliseconds(1000),
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
