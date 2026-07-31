/**
 * Конфиг-секция HTTP-транспорта.
 *
 * Токен секции наружу не экспортируется — только `keys`-хэндл: право
 * привязки источника безопасно отдавать, право инжекта секции нет
 * (keys-capability, см. `@nestling/config`).
 */

import { makeConfig } from '@nestling/config';
import { z } from 'zod';

/**
 * `HTTP_PORT` и `HTTP_HOST` — минимум, доказывающий, что транспорт-провайдер
 * инжектит зависимости. Остальные опции (`maxBodySize`, таймауты,
 * `sseHeartbeat`) остаются аргументом фабрики: они не про окружение.
 */
export const HttpConfig = makeConfig('http', {
  port: z.coerce.number().int().min(0).max(65_535).default(3000),
  host: z.string().default('0.0.0.0'),
});

/** Ключи секции — то, что пакет отдаёт наружу для `config:` в корне */
export const httpConfigKeys = HttpConfig.keys;
