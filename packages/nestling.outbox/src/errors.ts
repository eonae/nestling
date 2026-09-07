/**
 * Ошибки пакета.
 *
 * Это ошибки программы и композиции, а не отказы домена: клиент их
 * деталей не видит, пайплайн обрабатывает их как любое необработанное
 * исключение.
 */

/**
 * Транзакционный `emit` вызван вне транзакции.
 *
 * Режима «отправить напрямую, если транзакции нет» у пакета нет: он
 * превратил бы потерю события в невидимое поведение по умолчанию.
 */
export class OutboxTransactionMissingError extends Error {
  constructor(operationName: string, key: string) {
    super(
      `Operation '${operationName}': a transactional emit needs a ` +
        `transaction, but the context variable '${key}' is not there. Either ` +
        `compose this endpoint from the layer that opens the transaction, or ` +
        `inject '${operationName}.emitter' instead — that one publishes to ` +
        `the bus right away and needs no transaction.`,
    );
    this.name = 'OutboxTransactionMissingError';
  }
}
