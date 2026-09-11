/**
 * Приложение-фикстура: два соединения, endpoint в транзакции и endpoint
 * без неё.
 *
 * Собрано так же, как собиралось бы настоящее: соединение объявлено
 * значением, слой транзакции композируется в пайплайн endpoint'а, а
 * репозиторий читает переменную транзакции обычным `Ctx(...)`.
 */

import type { PgTx } from '../connection.js';
import { drizzlePg } from '../plugin.js';

import { analyticsSchema, schema, users } from './schema.js';
import { TestTransport$ } from './transport.js';

import type { CtxReader, Output } from '@nestlingjs/app';
import { Ctx, makeEndpoint } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { Ok } from '@nestlingjs/operations';
import { z } from 'zod';

/** Соединение по умолчанию: ключи `DATABASE_*`, переменная `tx` */
export const db = drizzlePg({ schema });

/** Второе соединение: ключи `DATABASE_ANALYTICS_*`, переменная `analyticsTx` */
export const analytics = drizzlePg({
  name: 'analytics',
  schema: analyticsSchema,
});

/** Хендлер, который пишет транзакцией запроса */
@Handler([Ctx(db.tx)])
export class CreateUserHandler {
  constructor(private readonly tx: CtxReader<PgTx<typeof schema>>) {}

  async handle(input: { id: string; email: string }): Output<{ id: string }> {
    await this.tx
      .get()
      .insert(users)
      .values({ id: input.id, email: input.email });

    return new Ok({ id: input.id });
  }
}

/** Endpoint в транзакции */
export const CreateUser = makeEndpoint({
  transport: TestTransport$,
  pattern: 'POST users',
  input: z.object({ id: z.string(), email: z.string() }),
  output: z.object({ id: z.string() }),
  pipeline: db.transaction(),
  handler: CreateUserHandler,
});

/** Endpoint без слоя транзакции — предмет политики предпосылки */
export const Ping = makeEndpoint({
  transport: TestTransport$,
  pattern: 'POST ping',
  output: z.object({ ok: z.boolean() }),
  handler: async (): Output<{ ok: boolean }> => new Ok({ ok: true }),
});
