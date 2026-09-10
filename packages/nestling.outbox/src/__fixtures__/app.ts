/**
 * Приложение-фикстура: слой транзакции, адаптер хранилища и один
 * endpoint, который пишет в outbox.
 *
 * Собрано так же, как собиралось бы настоящее: транзакцию открывает
 * пайплайн, хранилище живёт под своим DI-токеном приложения, а пакет
 * получает и то и другое параметрами плагина.
 */

import { outboxed } from '../emitter.js';
import { InMemoryOutboxStore } from '../memory-store.js';
import type { OutboxStore } from '../types.js';

import { TestTransaction, Tx } from './transaction.js';
import { TestTransport$ } from './transport.js';

import type { ExtendableContext, Output, Plugin } from '@nestlingjs/app';
import { makeEndpoint, makePipeline, makePlugin } from '@nestlingjs/app';
import { Component, Handler, makeToken } from '@nestlingjs/container';
import type { Emitter } from '@nestlingjs/operations';
import { makeEvent, Ok } from '@nestlingjs/operations';
import { z } from 'zod';

/** DI-токен адаптера хранилища; в приложении его объявляет приложение */
export const OutboxStore$ = makeToken<OutboxStore>('spec:OutboxStore');

/** Событие, которое endpoint отправляет транзакционно */
export const UserCreated = makeEvent({
  name: 'plugin.spec.user-created',
  input: z.object({ id: z.string(), email: z.string() }),
});

/** Второе событие: объявлено, но плагину не передано */
export const UserDeleted = makeEvent({
  name: 'plugin.spec.user-deleted',
  input: z.object({ id: z.string() }),
});

/**
 * Соединение с базой. В фикстуре это то же хранилище в памяти: тесту
 * важно, что транзакция и записи приходят с одного соединения.
 */
@Component([])
export class TestDatabase {
  readonly outbox = new InMemoryOutboxStore();

  begin(): TestTransaction {
    return new TestTransaction();
  }
}

/**
 * Юнит-мост: кладёт соединение в контекст.
 *
 * Он нужен, потому что `Var.provide(compute)` принимает функцию от
 * контекста и зависимостей из контейнера не получает, а соединение
 * приходит именно оттуда.
 */
@Handler([TestDatabase])
export class ProvideDb {
  constructor(private readonly db: TestDatabase) {}

  handle(): { db: TestDatabase } {
    return { db: this.db };
  }
}

/** Слой транзакции: открывает её до хендлера, закрывает после ответа */
export const transactional = makePipeline()
  .pre(ProvideDb)
  .pre(Tx.provide<{ db: TestDatabase }>((ctx) => ctx.input.db.begin()))
  .ok((_res, ctx: ExtendableContext<{ tx: TestTransaction }>) => {
    ctx.input.tx.commit();
  })
  .catch((error, ctx: ExtendableContext<{ tx?: TestTransaction }>) => {
    ctx.input.tx?.rollback();
  });

/** Полезная нагрузка endpoint'а */
const NewUser = z.object({
  id: z.string(),
  email: z.string(),
  fail: z.boolean().optional(),
});

/**
 * Хендлер с обоими эмиттерами: транзакционным и прямым.
 *
 * Оба резолвятся и работают рядом. Тело метода одинаковое — различается
 * только строка списка зависимостей.
 */
@Handler([outboxed(UserCreated), UserCreated.emitter])
export class CreateUserHandler {
  constructor(
    private readonly deferred: Emitter<typeof UserCreated>,
    private readonly direct: Emitter<typeof UserCreated>,
  ) {}

  async handle(input: z.infer<typeof NewUser>): Output<{ id: string }> {
    await this.deferred.emit({ id: input.id, email: input.email });
    await this.direct.emit({ id: input.id, email: input.email });

    if (input.fail) {
      throw new Error('handler failed after emit');
    }

    return new Ok({ id: input.id });
  }
}

/** Endpoint в транзакции: слой открывает её, хендлер пишет в outbox */
export const CreateUser = makeEndpoint({
  transport: TestTransport$,
  pattern: 'POST users',
  input: NewUser,
  output: z.object({ id: z.string() }),
  pipeline: transactional,
  handler: CreateUserHandler,
});

/** Хендлер, запросивший операцию, которой нет в списке плагина */
@Handler([outboxed(UserDeleted)])
export class DeleteUserHandler {
  constructor(private readonly deleted: Emitter<typeof UserDeleted>) {}

  async handle(input: { id: string }): Output<undefined> {
    await this.deleted.emit({ id: input.id });

    return new Ok(undefined);
  }
}

/** Endpoint для отрицательного теста «операция не перечислена» */
export const DeleteUser = makeEndpoint({
  transport: TestTransport$,
  pattern: 'DELETE users',
  input: z.object({ id: z.string() }),
  pipeline: transactional,
  handler: DeleteUserHandler,
});

/**
 * Инфраструктура базы: соединение, адаптер хранилища и юнит-мост слоя.
 *
 * Плагин, а не фича: `outbox(...)` — тоже плагин, и его relay инжектит
 * `OutboxStore$`. DI-токен фичи в зависимостях плагина ронял бы сборку
 * проверкой границы фич, и это правильно — инфраструктура, которая знает
 * о бизнес-логике, не переиспользуется и не отгружается отдельно.
 */
export const databasePlugin: Plugin = makePlugin({
  name: 'spec:database',
  providers: [
    TestDatabase,
    ProvideDb,
    {
      provide: OutboxStore$,
      useFactory: (db: TestDatabase) => db.outbox,
      deps: [TestDatabase],
    },
  ],
});

/** Endpoint без слоя транзакции — предмет политики предпосылки */
export const PingUser = makeEndpoint({
  transport: TestTransport$,
  pattern: 'POST ping',
  output: z.object({ ok: z.boolean() }),
  handler: async (): Output<{ ok: boolean }> => new Ok({ ok: true }),
});
