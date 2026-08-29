/**
 * Конфиг-секция NATS-транспорта.
 *
 * Токен секции наружу не экспортируется — только `keys`-хэндл: право
 * привязки источника безопасно отдавать, право инжекта секции нет
 * (keys-capability, см. `@nestling/config`).
 *
 * В секции живёт то, что меняется **между окружениями**: адреса кластера,
 * потолок ожидания и префикс subject'ов. Всё остальное (коннектор, кодек,
 * диагностические хуки) остаётся аргументом фабрики: это не про окружение,
 * а про сборку.
 */

import { makeConfig } from '@nestling/config';
import { z } from 'zod';

/** Адреса кластера: список через запятую, пустые элементы отбрасываются */
const serversSchema = z
  .string()
  .default('nats://127.0.0.1:4222')
  .transform((value) =>
    value
      .split(',')
      .map((server) => server.trim())
      .filter((server) => server.length > 0),
  )
  .pipe(z.array(z.string()).min(1));

/**
 * Секция `nats`: `NATS_SERVERS`, `NATS_REQUEST_TIMEOUT`,
 * `NATS_SUBJECT_PREFIX`.
 *
 * @internal Инжектится фабрикой транспорта; наружу отдаётся только `.keys`
 */
export const NatsConfig = makeConfig('nats', {
  servers: serversSchema,

  /**
   * Потолок ожидания req-reply.
   *
   * Не дефолтный **бюджет**: бюджет есть свойство вызова и наследуется
   * вглубь, потолок — свойство сети, как таймаут сокета у HTTP-сервера.
   * Брокерский запрос не бывает бесконечным, и вызов без `meta.deadline`
   * обязан завершиться.
   */
  requestTimeout: z.coerce.number().int().min(1).default(30_000),

  /** Префикс subject'ов: разделение окружений на общем кластере */
  subjectPrefix: z.string().default(''),
});

/** Ключи секции — то, что пакет отдаёт наружу для `config:` в корне */
export const natsConfigKeys = NatsConfig.keys;
