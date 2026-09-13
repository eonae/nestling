/**
 * Секция конфигурации логгера ядра: порог записи и формат.
 *
 * Секция не reloadable: reloadable-секция без наблюдающего источника
 * предупреждает, а на голом `process.env` это каждое приложение.
 *
 * DI-токен секции наружу не экспортируется: граница ядра держится
 * видимостью ES-модулей, снаружи доступен только `.keys`.
 */

import { makeConfig } from '../config/index.js';

import type { LogFormat, LogThreshold } from '@nestlingjs/logging';
import { z } from 'zod';

/**
 * Допустимые пороги; `satisfies` сторожит совпадение с `LogThreshold`.
 *
 * `silent` стоит в перечне пятым значением: это порог, который отсекает
 * все четыре уровня, а не уровень, которым пишут.
 */
const LEVELS = [
  'debug',
  'info',
  'warn',
  'error',
  'silent',
] as const satisfies readonly LogThreshold[];

/** Допустимые форматы; тот же перечень, что у типа `LogFormat` */
const FORMATS = ['text', 'json'] as const satisfies readonly LogFormat[];

/** Префикс секции логгера ядра */
export const NESTLING_LOG_PREFIX = 'nestlingLog';

/**
 * Секция конфигурации логгера: `NESTLING_LOG_LEVEL` и `NESTLING_LOG_FORMAT`.
 *
 * Схемы написаны на zod, как и все схемы, которые фреймворк пишет сам:
 * перечисление конвертируется в JSON Schema штатным конвертером, а текст
 * отказа приходит от валидатора. Билдеры `@nestlingjs/schema.zod` ядру не
 * годятся: тот пакет зависит от этого, и обратная стрелка замкнула бы цикл.
 *
 * @internal Проецируется на фазе 0 корневым логгером; наружу отдаётся
 * только `.keys`
 */
export const NestlingLogConfig = makeConfig(NESTLING_LOG_PREFIX, {
  level: z.enum(LEVELS).default('info'),
  format: z.enum(FORMATS).default('text'),
});

/** Ключи секции — то, что пакет отдаёт наружу для `config:` в корне */
export const logConfigKeys = NestlingLogConfig.keys;

/** Проекция секции логгера */
export interface LogConfig {
  readonly level: LogThreshold;
  readonly format: LogFormat;
}
