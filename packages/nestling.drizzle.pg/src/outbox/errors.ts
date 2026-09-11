/**
 * Ошибка адаптера: значение транзакции не той формы.
 *
 * Текст называет обе починки, потому что причин ровно две: слоя этого
 * соединения нет в пайплайне, или плагину outbox'а передана переменная
 * другого соединения.
 */

/** Значение транзакции не годится для записи адаптером */
export class PgOutboxTransactionError extends TypeError {
  constructor(received: string) {
    super(
      `pgOutboxStore.append(transaction, …): expected the drizzle value of ` +
        `this connection's transaction, got ${received}. Either compose ` +
        `db.transaction() into the pipeline of this endpoint, or pass the ` +
        `transaction variable of this very connection to outbox({ ` +
        `transaction }) — the record and the business row must be written ` +
        `by one transaction.`,
    );
    this.name = 'PgOutboxTransactionError';
  }
}
