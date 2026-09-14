/**
 * Секция конфигурации пакета: `OUTBOX_*`.
 *
 * Наружу отдаются только ключи: DI-токен секции остаётся приватным, и
 * инжектировать её может только этот пакет. Так же устроены секции ядра и
 * транспортов.
 */

import type {
  ConfigKeys,
  ConfigSectionToken,
  ConfigValues,
} from '@nestlingjs/app';
import { makeConfig } from '@nestlingjs/app';
import { flag, int } from '@nestlingjs/schema.zod';
import type { z } from 'zod';

/**
 * Секция relay.
 *
 * Все поля — про то, как relay разбирает записи, поэтому все читаются из
 * окружения процесса, а не из аргумента фабрики: в split-развёртывании
 * два процесса поднимают один и тот же плагин с разными значениями.
 *
 * @internal Инжектируется relay; наружу отдаётся `outboxConfigKeys`
 */
export const OutboxConfig: ConfigSectionToken<
  ConfigValues<
    {
      pollIntervalMs: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
      batchSize: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
      backoffMs: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
      backoffMaxMs: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
      maxAttempts: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
      relay: z.ZodDefault<
        z.ZodUnion<
          readonly [z.ZodBoolean, z.ZodCodec<z.ZodString, z.ZodBoolean>]
        >
      >;
    },
    Record<never, never>
  >,
  'outbox'
> = makeConfig('outbox', {
  /** Пауза между проходами, когда прошлая партия была пуста */
  pollIntervalMs: int().min(0).default(1000),

  /** Сколько записей relay берёт за один проход */
  batchSize: int().min(1).default(100),

  /** Пауза перед первым повтором; дальше она удваивается */
  backoffMs: int().min(0).default(500),

  /** Потолок паузы между повторами */
  backoffMaxMs: int().min(0).default(30_000),

  /** Сколько попыток публикации до отметки «застряла» */
  maxAttempts: int().min(1).default(10),

  /**
   * Крутит ли этот процесс relay.
   *
   * В split-развёртывании записи создают все процессы, а разбирает их
   * один: две реплики relay конкурируют за одну таблицу, и платить этим
   * без нужды незачем.
   */
  relay: flag().default(true),
});

/** Ключи секции — то, что пакет отдаёт наружу для `config:` в корне */
export const outboxConfigKeys: ConfigKeys<'outbox'> = OutboxConfig.keys;

/** Проекция секции */
export interface OutboxConfigValues {
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly backoffMs: number;
  readonly backoffMaxMs: number;
  readonly maxAttempts: number;
  readonly relay: boolean;
}
