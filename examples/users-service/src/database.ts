import type { User } from './users/user.js';
import { AppConfig } from './app.config.js';

import type { Config, Logger } from '@nestling/app';
import { Logger$ } from '@nestling/app';
import { Resource } from '@nestling/container';
import { InMemoryOutboxStore } from '@nestling/outbox';

/**
 * Транзакция: то, что в настоящем сервисе даёт драйвер базы.
 *
 * Здесь она откладывает записи до коммита, а откат просто их забывает.
 * Настоящая транзакция показала бы свои записи читателю внутри себя;
 * таблица в памяти этого не умеет, и запись становится видимой после
 * коммита.
 */
export class Transaction {
  readonly #actions: (() => void)[] = [];

  /** Регистрирует запись, которая выполнится при коммите */
  onCommit(action: () => void): void {
    this.#actions.push(action);
  }

  /** Применяет отложенные записи */
  commit(): void {
    for (const action of this.#actions) {
      action();
    }

    this.#actions.length = 0;
  }

  /** Забывает отложенные записи: их не было */
  rollback(): void {
    this.#actions.length = 0;
  }
}

/**
 * Соединение с базой. В примере это таблица в памяти.
 *
 * Соединение — ресурс: его открывает `acquire` на фазе INIT и закрывает
 * `release` на SHUTDOWN. Конструктор получает уже открытую таблицу,
 * поэтому поле не проходит через `undefined` и проверки в геттере нет.
 *
 * Здесь же живёт хранилище outbox'а: запись события и запись пользователя
 * обязаны быть на одном соединении, иначе одной транзакцией их не
 * закоммитить.
 */
@Resource([AppConfig, Logger$.auto])
export class Database {
  static async acquire(
    config: Config<typeof AppConfig>,
    logger: Logger,
    _signal: AbortSignal,
  ): Promise<Database> {
    // В лог уходит только хост: значение поля секретное
    logger.info('database connected', {
      host: new URL(config.databaseUrl).host,
    });

    return new Database(logger, [
      { id: '1', name: 'Alice', email: 'alice@example.com' },
      { id: '2', name: 'Bob', email: 'bob@example.com' },
    ]);
  }

  /** Хранилище outbox'а на том же соединении, что и таблица */
  readonly outbox = new InMemoryOutboxStore();

  #lastId: number;

  private constructor(
    private readonly logger: Logger,
    /** Таблица пользователей */
    readonly users: User[],
  ) {
    this.#lastId = users.length;
  }

  /** Открывает транзакцию: её закрывает слой пайплайна */
  begin(): Transaction {
    return new Transaction();
  }

  /**
   * Следующий идентификатор.
   *
   * Счётчик, а не длина таблицы: запись откладывается до коммита, и
   * длина в момент вставки ещё не изменилась.
   */
  nextId(): string {
    this.#lastId += 1;

    return String(this.#lastId);
  }

  release(): void {
    this.users.length = 0;
    this.logger.info('database disconnected');
  }
}
