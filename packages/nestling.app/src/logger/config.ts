/**
 * Секция конфигурации логгера ядра: уровень и формат.
 *
 * Секция не reloadable: reloadable-секция без наблюдающего источника
 * предупреждает, а на голом `process.env` это каждое приложение.
 *
 * DI-токен секции наружу не экспортируется: граница ядра держится
 * видимостью ES-модулей, снаружи доступен только `.keys`.
 */

import { makeConfig } from '../config/index.js';

import type { LogLevel } from './interface.js';

import type { StandardSchemaV1 } from '@common/misc';

/** Формат записи в `stderr` */
export type LogFormat = 'text' | 'json';

/** Допустимые уровни — тем же значением их перечисляет текст ошибки */
const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** Допустимые форматы — тем же значением их перечисляет текст ошибки */
const FORMATS: readonly LogFormat[] = ['text', 'json'];

/**
 * Схема перечисления с умолчанием, написанная руками.
 *
 * Standard Schema это интерфейс, а не библиотека: ядру не нужен вендор,
 * чтобы объявить перечисление из нескольких значений (тот же приём, что у
 * секции портов).
 */
const enumeration = <T extends string>(
  values: readonly T[],
  fallback: T,
): StandardSchemaV1<unknown, T> => ({
  '~standard': {
    version: 1,
    vendor: 'nestling',
    validate: (value) => {
      if (value === undefined || value === null || value === '') {
        return { value: fallback };
      }

      return values.includes(value as T)
        ? { value: value as T }
        : {
            issues: [
              {
                message:
                  `Expected one of ${values.map((v) => `'${v}'`).join(', ')}, ` +
                  `got ${JSON.stringify(value)}`,
              },
            ],
          };
    },
  },
});

/** Префикс секции логгера ядра */
export const NESTLING_LOG_PREFIX = 'nestlingLog';

/**
 * Секция конфигурации логгера: `NESTLING_LOG_LEVEL` и `NESTLING_LOG_FORMAT`.
 *
 * @internal Проецируется на фазе 0 корневым логгером; наружу отдаётся
 * только `.keys`
 */
export const NestlingLogConfig = makeConfig(NESTLING_LOG_PREFIX, {
  level: enumeration(LEVELS, 'info'),
  format: enumeration(FORMATS, 'text'),
});

/** Ключи секции — то, что пакет отдаёт наружу для `config:` в корне */
export const logConfigKeys = NestlingLogConfig.keys;

/** Проекция секции логгера */
export interface LogConfig {
  readonly level: LogLevel;
  readonly format: LogFormat;
}
