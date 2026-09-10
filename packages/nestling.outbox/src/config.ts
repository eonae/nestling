/**
 * Секция конфигурации пакета: `OUTBOX_*`.
 *
 * Наружу отдаются только ключи: DI-токен секции остаётся приватным, и
 * инжектировать её может только этот пакет. Так же устроены секции ядра и
 * транспортов.
 */

import { flag, int } from './schema.js';

import { makeConfig } from '@nestlingjs/app';

/**
 * Секция relay.
 *
 * Все поля — про то, как relay разбирает записи, поэтому все читаются из
 * окружения процесса, а не из аргумента фабрики: в split-развёртывании
 * два процесса поднимают один и тот же плагин с разными значениями.
 *
 * @internal Инжектируется relay; наружу отдаётся `outboxConfigKeys`
 */
export const OutboxConfig = makeConfig('outbox', {
  /** Пауза между проходами, когда прошлая партия была пуста */
  pollIntervalMs: int(1000, 0),

  /** Сколько записей relay берёт за один проход */
  batchSize: int(100, 1),

  /** Пауза перед первым повтором; дальше она удваивается */
  backoffMs: int(500, 0),

  /** Потолок паузы между повторами */
  backoffMaxMs: int(30_000, 0),

  /** Сколько попыток публикации до отметки «застряла» */
  maxAttempts: int(10, 1),

  /**
   * Крутит ли этот процесс relay.
   *
   * В split-развёртывании записи создают все процессы, а разбирает их
   * один: две реплики relay конкурируют за одну таблицу, и платить этим
   * без нужды незачем.
   */
  relay: flag(true),
});

/** Ключи секции — то, что пакет отдаёт наружу для `config:` в корне */
export const outboxConfigKeys = OutboxConfig.keys;

/** Проекция секции */
export interface OutboxConfigValues {
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly backoffMs: number;
  readonly backoffMaxMs: number;
  readonly maxAttempts: number;
  readonly relay: boolean;
}
