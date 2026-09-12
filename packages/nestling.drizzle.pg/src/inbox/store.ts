/**
 * Адаптер `InboxStore` на drizzle.
 *
 * Отметка ставится транзакцией вызывающего, поэтому строка отметки и
 * строка бизнес-изменения коммитятся вместе. Проход уборщика идёт на
 * пуле: уборщик живёт вне запроса и транзакции не имеет.
 */

import type { PgConnection, PgSchema, PgTx } from '../connection.js';

import { PgInboxTransactionError } from './errors.js';
import { DEFAULT_INBOX_TABLE } from './table.js';

import type {
  InboxClaim,
  InboxMark,
  InboxStore,
  InboxSweepOptions,
} from '@nestlingjs/inbox';
import { sql } from 'drizzle-orm';

/** Значение транзакции: экземпляр drizzle этого соединения */
function assertTx(value: unknown): asserts value is PgTx<PgSchema> {
  const candidate = value as { insert?: unknown; execute?: unknown } | null;

  if (
    typeof candidate?.insert !== 'function' ||
    typeof candidate.execute !== 'function'
  ) {
    throw new PgInboxTransactionError(
      value === null || value === undefined ? String(value) : typeof value,
    );
  }
}

/** Момент epoch-миллисекундами в значение колонки */
const at = (ms: number) => sql`to_timestamp(${ms}::double precision / 1000)`;

/**
 * Хранилище отметок в PostgreSQL.
 *
 * Семантика повторяет `InMemoryInboxStore`: пара «потребитель и ключ»
 * отмечается один раз, откат транзакции отметку убирает, проход удаляет
 * отметки старше срока. Расхождение между реализациями — дефект, и его
 * ловит общий набор проверок.
 */
export class PgInboxStore implements InboxStore {
  constructor(
    private readonly connection: PgConnection<PgSchema>,
    /** Имя таблицы отметок */
    private readonly table: string = DEFAULT_INBOX_TABLE,
  ) {}

  async claim(transaction: unknown, mark: InboxMark): Promise<InboxClaim> {
    assertTx(transaction);

    // `ON CONFLICT DO NOTHING` вместо голой вставки: нарушение
    // уникальности рвёт транзакцию в PostgreSQL целиком, и тогда слой не
    // смог бы завершить endpoint успехом — коммитить было бы нечего.
    // Вторая транзакция ждёт первую на замке строки и получает ноль строк
    const result = await transaction.execute(sql`
      INSERT INTO ${this.name} ("consumer", "key", "received_at")
      VALUES (${mark.consumer}, ${mark.key}, ${at(mark.receivedAt)})
      ON CONFLICT ("consumer", "key") DO NOTHING
      RETURNING "key"
    `);

    return result.rows.length > 0 ? 'claimed' : 'duplicate';
  }

  async sweep(options: InboxSweepOptions): Promise<number> {
    // Партия ограничивается подзапросом: `DELETE` не принимает `LIMIT`
    const result = await this.connection.db.execute(sql`
      DELETE FROM ${this.name}
      WHERE ctid IN (
        SELECT c.ctid
        FROM ${this.name} c
        WHERE c."received_at" < ${at(options.olderThan)}
        LIMIT ${options.limit}
      )
      RETURNING "key"
    `);

    return result.rows.length;
  }

  /** Имя таблицы идентификатором: в текст запроса оно едет так */
  private get name() {
    return sql.identifier(this.table);
  }
}
