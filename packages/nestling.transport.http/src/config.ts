/**
 * Конфиг-секция HTTP-транспорта.
 *
 * Наружу уходит только `keys` (право привязать источник); токен секции
 * остаётся приватным, и инжектировать её может только этот пакет
 * (см. `@nestling/config`).
 */

import { makeConfig } from '@nestling/config';
import { z } from 'zod';

/**
 * Секция с ключами `HTTP_PORT` и `HTTP_HOST`. Остальные опции
 * (`maxBodySize`, таймауты, `sseHeartbeat`) задаются аргументом фабрики:
 * они не зависят от окружения.
 */
export const HttpConfig = makeConfig('http', {
  port: z.coerce.number().int().min(0).max(65_535).default(3000),
  host: z.string().default('0.0.0.0'),
});

/** Ключи секции для привязки источника в `config:` корня */
export const httpConfigKeys = HttpConfig.keys;
