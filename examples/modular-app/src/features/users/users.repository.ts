import { db } from '../../persistence.js';
import type { schema } from '../../schema.js';
import { users } from '../../schema.js';

import type { CtxReader } from '@nestlingjs/app';
import { Ctx } from '@nestlingjs/app';
import { Component, makeToken } from '@nestlingjs/container';
import type { PgConnection, PgTx } from '@nestlingjs/drizzle.pg';
import { eq } from 'drizzle-orm';

/** Пользователь в границах этой фичи */
export interface User {
  id: string;
  name: string;
  email: string;
}

/** Хранилище пользователей: всё, что фиче нужно от базы */
export interface UsersRepository {
  byEmail(email: string): Promise<User | null>;
  insert(data: Omit<User, 'id'>): Promise<User>;
  removeByEmail(email: string): Promise<User | null>;
}

/**
 * DI-токен хранилища. Реализации операций зависят от него, а не от
 * класса, поэтому тест подменяет хранилище одной строкой в `overrides`.
 */
export const UsersRepository$ = makeToken<UsersRepository>('UsersRepository');

/**
 * Хранилище поверх соединения с PostgreSQL.
 *
 * Читающий метод берёт соединение из пула (`connection.db`), изменяющий —
 * транзакцию запроса (`Ctx(db.tx)`): так запись пользователя и запись
 * события попадают в один коммит.
 */
@Component([db.connection, Ctx(db.tx)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly connection: PgConnection<typeof schema>,
    private readonly tx: CtxReader<PgTx<typeof schema>>,
  ) {}

  async byEmail(email: string): Promise<User | null> {
    const [row] = await this.connection.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return row ?? null;
  }

  async insert(data: Omit<User, 'id'>): Promise<User> {
    const [row] = await this.tx
      .get()
      .insert(users)
      .values({ id: crypto.randomUUID(), ...data })
      .returning();

    return row;
  }

  async removeByEmail(email: string): Promise<User | null> {
    const [row] = await this.tx
      .get()
      .delete(users)
      .where(eq(users.email, email))
      .returning();

    return row ?? null;
  }
}
