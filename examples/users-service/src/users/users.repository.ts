import type { Transaction } from '../database.js';
import { Database } from '../database.js';
import { Tx } from '../persistence.js';

import type { User } from './user.js';

import type { CtxReader, Logger } from '@nestling/app';
import { Ctx, Logger$, RequestId } from '@nestling/app';
import { Component, makeToken } from '@nestling/container';

/** Хранилище пользователей: всё, что endpoint'ам нужно от базы */
export interface UsersRepository {
  all(): Promise<User[]>;
  byId(id: string): Promise<User | null>;
  byEmail(email: string): Promise<User | null>;
  insert(data: Omit<User, 'id'>): Promise<User>;
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
 * Читает из контекста две переменные. `Ctx(RequestId)` даёт идентификатор
 * запроса: в лог он попадает без передачи параметром. `Ctx(Tx)` даёт
 * транзакцию: изменяющий метод пишет ею, а не мимо неё, и потому попадает
 * в один коммит с записью outbox'а. Обе переменные кладут слои пайплайна.
 *
 * Привязку к DI-токену интерфейса записывает `classProvider(UsersRepository$,
 * DbUsersRepository)` в `providers:` фичи.
 */
@Component([Database, Logger$.auto, Ctx(RequestId), Ctx(Tx)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly requestId: CtxReader<string>,
    private readonly tx: CtxReader<Transaction>,
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

  async insert(data: Omit<User, 'id'>): Promise<User> {
    this.trace(`insert ${data.email}`);

    const user: User = { id: this.db.nextId(), ...data };

    // Запись идёт транзакцией запроса: откат её не выполнит
    this.tx.get().onCommit(() => this.db.users.push(user));

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

    const patched: User = { ...this.db.users[index], ...data };
    this.tx.get().onCommit(() => {
      this.db.users[index] = patched;
    });

    return patched;
  }

  async remove(id: string): Promise<boolean> {
    const index = this.db.users.findIndex((user) => user.id === id);
    if (index === -1) {
      return false;
    }

    this.tx.get().onCommit(() => this.db.users.splice(index, 1));

    return true;
  }

  /**
   * Пишет запись с идентификатором запроса полем.
   *
   * `peek()` вместо `get()`: тот же метод может быть вызван вне запроса,
   * например из хука `@OnStart`, и тогда идентификатора нет.
   */
  private trace(operation: string): void {
    this.logger.debug(operation, { requestId: this.requestId.peek() ?? 'n/a' });
  }
}
