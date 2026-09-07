import type { User } from './users/user.js';
import { AppConfig } from './app.config.js';

import type { Config, Logger } from '@nestling/app';
import { Logger$ } from '@nestling/app';
import { Resource } from '@nestling/container';

/**
 * Соединение с базой. В примере это таблица в памяти.
 *
 * Соединение — ресурс: его открывает `acquire` на фазе INIT и закрывает
 * `release` на SHUTDOWN. Конструктор получает уже открытую таблицу,
 * поэтому поле не проходит через `undefined` и проверки в геттере нет.
 */
@Resource([AppConfig, Logger$.auto])
export class Database {
  static async acquire(
    config: Config<typeof AppConfig>,
    logger: Logger,
    _signal: AbortSignal,
  ): Promise<Database> {
    // В лог уходит только хост, а не адрес целиком: хост считает
    // вычисляемое поле секции
    logger.info('database connected', { host: config.databaseHost });

    return new Database(logger, [
      { id: '1', name: 'Alice', email: 'alice@example.com' },
      { id: '2', name: 'Bob', email: 'bob@example.com' },
    ]);
  }

  private constructor(
    private readonly logger: Logger,
    /** Таблица пользователей */
    readonly users: User[],
  ) {}

  release(): void {
    this.users.length = 0;
    this.logger.info('database disconnected');
  }
}
