/**
 * Ошибки пакета.
 *
 * Это ошибки композиции и конверта, а не отказы домена: клиент их деталей
 * не видит, пайплайн обрабатывает их как любое необработанное исключение.
 */

/**
 * У доставленного сообщения нет ключа идемпотентности.
 *
 * Дедуплицировать такое сообщение нечем. Чеканить ключ на приёме пакет не
 * станет: отчеканенный ключ различается у двух доставок одного сообщения
 * и всегда выглядел бы новым, то есть гарантия молча перестала бы
 * работать.
 */
export class InboxKeyMissingError extends Error {
  constructor(pattern: string, attribute: string) {
    super(
      `Endpoint '${pattern}': the delivered message carries no ` +
        `'${attribute}' attribute, and the inbox layer deduplicates by it. ` +
        `Either have the publisher pass an idempotency key, or send the ` +
        `event through the outbox — its relay publishes each record with ` +
        `the record id as the key.`,
    );
    this.name = 'InboxKeyMissingError';
  }
}
