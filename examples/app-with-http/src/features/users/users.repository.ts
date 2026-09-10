import { Database } from './database.js';
import type { NewUser, User } from './user.js';

import type { CtxReader, Logger } from '@nestlingjs/app';
import { Ctx, Logger$, RequestId } from '@nestlingjs/app';
import { Component, makeToken } from '@nestlingjs/container';

/** Хранилище пользователей: всё, что endpoint'ам нужно от базы */
export interface UsersRepository {
  all(): Promise<User[]>;
  byId(id: string): Promise<User | null>;
  byEmail(email: string): Promise<User | null>;
  insert(data: NewUser): Promise<User>;
  patch(id: string, data: Partial<Omit<User, 'id'>>): Promise<User | null>;
  remove(id: string): Promise<boolean>;
}

/**
 * DI-токен хранилища. Endpoint'ы зависят от него, а не от класса, поэтому
 * тест подменяет хранилище одной строкой в `overrides`.
 */
export const UsersRepository$ = makeToken<UsersRepository>('UsersRepository');

/**
 * Хранилище поверх соединения `Database`.
 *
 * `Ctx(RequestId)` читает идентификатор запроса из контекста: в лог он
 * попадает без передачи параметром. Значение кладёт слой `observability`.
 *
 * Привязку к DI-токену интерфейса записывает `classProvider(UsersRepository$,
 * DbUsersRepository)` в `providers:` модуля.
 */
@Component([Database, Logger$.auto, Ctx(RequestId)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly requestId: CtxReader<string>,
  ) {}

  async all(): Promise<User[]> {
    this.trace('all');

    return this.db.users;
  }

  async byId(id: string): Promise<User | null> {
    this.trace(`byId ${id}`);

    return this.db.users.find((user) => user.id === id) ?? null;
  }

  async byEmail(email: string): Promise<User | null> {
    return this.db.users.find((user) => user.email === email) ?? null;
  }

  async insert(data: NewUser): Promise<User> {
    this.trace(`insert ${data.email}`);

    const user: User = { id: String(this.db.users.length + 1), ...data };
    this.db.users.push(user);

    return user;
  }

  async patch(
    id: string,
    data: Partial<Omit<User, 'id'>>,
  ): Promise<User | null> {
    const index = this.db.users.findIndex((user) => user.id === id);
    if (index === -1) {
      return null;
    }

    this.db.users[index] = { ...this.db.users[index], ...data };

    return this.db.users[index];
  }

  async remove(id: string): Promise<boolean> {
    const index = this.db.users.findIndex((user) => user.id === id);
    if (index === -1) {
      return false;
    }

    this.db.users.splice(index, 1);

    return true;
  }

  /**
   * Пишет запись уровня `debug` с идентификатором запроса полем.
   *
   * `peek()` вместо `get()`: тот же метод может быть вызван вне запроса,
   * например из хука `@OnStart`, и тогда идентификатора нет.
   */
  private trace(operation: string): void {
    this.logger.debug(operation, { requestId: this.requestId.peek() ?? 'n/a' });
  }
}
