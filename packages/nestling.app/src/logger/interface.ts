/**
 * Интерфейс логгера ядра.
 *
 * Ядро и приложение пишут через один интерфейс: четыре уровня, три формы
 * вызова у каждого и `child` для привязок. Реализацию выбирает провайдер
 * под `RootLogger$`; ядро от библиотек логирования не зависит.
 */

/** Уровень записи; порядок — от подробного к важному */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Поля записи.
 *
 * Ключ `err` зарезервирован за ошибкой: реализация сериализует его как
 * ошибку (`name`, `message`, `stack`, `cause`), а не как произвольное
 * значение.
 */
export type Fields = Record<string, unknown> & { err?: unknown };

/**
 * Метод уровня: три формы вызова.
 *
 * - `(message, fields?)` — сообщение и поля;
 * - `(error, fields?)` — сообщение берётся из `error.message`, сама ошибка
 *   кладётся в `err`. `Fail` наследует `Error` и проходит этой формой;
 * - `(fields)` — запись без сообщения.
 */
export interface LogMethod {
  (message: string, fields?: Fields): void;
  // Формы с сообщением и с ошибкой различаются смыслом, а не только типом:
  // сообщение записи берётся из `error.message`, и читатель сигнатуры
  // должен видеть обе формы отдельно.
  // eslint-disable-next-line @typescript-eslint/unified-signatures
  (error: Error, fields?: Fields): void;
  (fields: Fields): void;
}

/**
 * Логгер: четыре уровня и дочерний логгер с привязками.
 *
 * @example
 * ```typescript
 * @Injectable([Logger$.auto])
 * export class UsersRepository {
 *   constructor(private readonly logger: Logger) {}
 *
 *   async byId(id: string) {
 *     this.logger.debug('select', { id });
 *   }
 * }
 * ```
 */
export interface Logger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;

  /**
   * Возвращает логгер, который добавляет `bindings` к каждой записи.
   *
   * Привязки дочернего логгера накладываются поверх родительских, поля
   * вызова — поверх привязок.
   */
  child(bindings: Fields): Logger;
}
