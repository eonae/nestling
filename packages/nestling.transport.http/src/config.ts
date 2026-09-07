/**
 * Конфиг-секция HTTP-сервера — семейство по имени экземпляра.
 *
 * Наружу уходит только `httpServerKeys(name?)` (право привязать источник);
 * токен секции остаётся приватным, и инжектировать её может только этот
 * пакет (см. `@nestling/app`).
 */

import type { ConfigKeys } from '@nestling/app';
import { DEFAULT_INSTANCE, makeConfig } from '@nestling/app';
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
export const HttpServerConfig = makeConfig.family('http', {
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
 * config: [[dotenv('.env'), httpServerKeys()]]
 * config: [[dotenv('.env'), httpServerKeys('admin')]]
 * ```
 */
export const httpServerKeys = (
  instance: string = DEFAULT_INSTANCE,
): ConfigKeys => HttpServerConfig(instance).keys;
