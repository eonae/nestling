/**
 * Ошибки пакета: подключение, повторное имя соединения, чужая транзакция.
 *
 * Каждая называет починку в том же тексте, что и саму нехватку: читатель
 * видит ошибку в логе старта или в стеке запроса, а не в документации.
 */

/**
 * База недоступна на фазе INIT.
 *
 * Текст называет имя соединения и ключ конфига с адресом: приложение с
 * двумя соединениями иначе не знает, какое из них не поднялось.
 */
export class PgConnectionFailedError extends Error {
  constructor(
    connection: string,
    urlKey: string,
    options?: { cause?: unknown },
  ) {
    super(
      `Database connection '${connection}' did not open: check that the ` +
        `address in ${urlKey} points at a running PostgreSQL and that the ` +
        `credentials in it are current.`,
      options,
    );
    this.name = 'PgConnectionFailedError';
  }
}

/**
 * Два соединения с одним именем.
 *
 * Имя экземпляра задаёт и ключи конфига, и идентификатор DI-токена, и
 * поле контекста с сессией: у двух соединений с одним именем совпало бы
 * всё три раза.
 */
export class PgDuplicateConnectionError extends Error {
  constructor(connection: string) {
    super(
      `Database connection '${connection}' is already declared. The instance ` +
        `name yields the config keys, the DI token id and the context field ` +
        `of the transaction, so two declarations under one name would ` +
        `collide. Either give this one a different name, or export the first ` +
        `declaration and use that value.`,
    );
    this.name = 'PgDuplicateConnectionError';
  }
}
