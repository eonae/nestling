/**
 * Конфиг-секция HTTP-сервера — семейство по имени экземпляра.
 *
 * Наружу уходит только `serverKeys(name?)` (право привязать источник);
 * DI-токен секции остаётся приватным, и инжектировать её может только
 * этот пакет (см. `@nestlingjs/app`).
 */

import type {
  ConfigKeys,
  ConfigSectionToken,
  ConfigValues,
} from '@nestlingjs/app';
import { DEFAULT_INSTANCE, makeConfig } from '@nestlingjs/app';
import { z } from 'zod';

/**
 * Секция сервера: `HTTP_PORT` и `HTTP_HOST` у экземпляра по умолчанию,
 * `HTTP_ADMIN_PORT` и `HTTP_ADMIN_HOST` у `name: 'admin'`.
 *
 * Семейство, а не одна секция на пакет: сокет у каждого сервера свой, два
 * слушателя на один порт не биндятся. Остальные опции (`maxBodySize`,
 * таймауты, `sseHeartbeat`) задаются аргументом фабрики: они не зависят от
 * окружения.
 */
export const HttpServerConfig: (instance: string) => ConfigSectionToken<
  ConfigValues<
    {
      port: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
      host: z.ZodDefault<z.ZodString>;
    },
    Record<never, never>
  >,
  string
> = makeConfig.family('http', {
  port: z.coerce.number().int().min(0).max(65_535).default(3000),
  host: z.string().default('0.0.0.0'),
});

/**
 * Ключи секции одного сервера — для привязки источника в `config:` корня.
 *
 * @param instance - Имя экземпляра сервера; без него — по умолчанию
 * @returns Дескриптор ключей этого экземпляра
 *
 * @example
 * ```typescript
 * config: [[dotenv('.env'), serverKeys()]]
 * config: [[dotenv('.env'), serverKeys('admin')]]
 * ```
 */
export const serverKeys = (instance: string = DEFAULT_INSTANCE): ConfigKeys =>
  HttpServerConfig(instance).keys;
