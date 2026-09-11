import { db } from '../persistence.js';
import type { schema } from '../schema.js';
import { users } from '../schema.js';

import type { User } from './user.js';

import type { CtxReader, Logger } from '@nestlingjs/app';
import { Ctx, Logger$, RequestId } from '@nestlingjs/app';
import { Component, makeToken } from '@nestlingjs/container';
import type { PgConnection, PgTx } from '@nestlingjs/drizzle.pg';
import { eq } from 'drizzle-orm';

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

/** Строка таблицы в значение ответа: пустая колонка — отсутствие поля */
const toUser = (row: typeof users.$inferSelect): User => ({
  id: row.id,
  name: row.name,
  email: row.email,
  ...(row.avatarUrl === null ? {} : { avatarUrl: row.avatarUrl }),
});

/**
 * Хранилище поверх соединения с PostgreSQL.
 *
 * Читающий метод берёт соединение из пула (`connection.db`), изменяющий —
 * транзакцию запроса (`Ctx(db.tx)`): так запись пользователя и запись
 * события попадают в один коммит. Обе переменные контекста кладут слои
 * пайплайна, а `Ctx(RequestId)` даёт идентификатор запроса — в лог он
 * попадает без передачи параметром.
 *
 * Привязку к DI-токену интерфейса записывает `classProvider(UsersRepository$,
 * DbUsersRepository)` в `providers:` фичи.
 */
@Component([db.connection, Logger$.auto, Ctx(RequestId), Ctx(db.tx)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly connection: PgConnection<typeof schema>,
    private readonly logger: Logger,
    private readonly requestId: CtxReader<string>,
    private readonly tx: CtxReader<PgTx<typeof schema>>,
  ) {}

  async all(): Promise<User[]> {
    this.trace('all');

    const rows = await this.connection.db.select().from(users);

    return rows.map((row) => toUser(row));
  }

  async byId(id: string): Promise<User | null> {
    this.trace(`byId ${id}`);

    const [row] = await this.connection.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return row ? toUser(row) : null;
  }

  async byEmail(email: string): Promise<User | null> {
    const [row] = await this.connection.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return row ? toUser(row) : null;
  }

  async insert(data: Omit<User, 'id'>): Promise<User> {
    this.trace(`insert ${data.email}`);

    // Запись идёт транзакцией запроса: откат её не сохранит
    const [row] = await this.tx
      .get()
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: data.name,
        email: data.email,
        avatarUrl: data.avatarUrl ?? null,
      })
      .returning();

    return toUser(row);
  }

  async patch(
    id: string,
    data: Partial<Omit<User, 'id'>>,
  ): Promise<User | null> {
    const [row] = await this.tx
      .get()
      .update(users)
      .set(data)
      .where(eq(users.id, id))
      .returning();

    return row ? toUser(row) : null;
  }

  async remove(id: string): Promise<boolean> {
    const removed = await this.tx
      .get()
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });

    return removed.length > 0;
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
