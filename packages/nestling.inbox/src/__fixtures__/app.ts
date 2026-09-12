/**
 * Приложение-фикстура: слой транзакции, адаптер хранилища и подписчики
 * события под слоем приёма.
 *
 * Собрано так же, как собиралось бы настоящее: транзакцию открывает
 * пайплайн, хранилище живёт под своим DI-токеном приложения, а пакет
 * получает и то и другое параметрами плагина.
 */

import { InMemoryInboxStore } from '../memory-store.js';
import type { InboxStore } from '../types.js';

import { TestTransaction, Tx } from './transaction.js';

import type { ExtendableContext, Output, Plugin } from '@nestlingjs/app';
import { makePipeline, makePlugin } from '@nestlingjs/app';
import { Component, makeToken } from '@nestlingjs/container';
import { makeEvent, Ok } from '@nestlingjs/operations';
import { z } from 'zod';

/** DI-токен адаптера хранилища; в приложении его объявляет приложение */
export const InboxStore$ = makeToken<InboxStore>('spec:InboxStore');

/** Событие, которое доставляется подписчикам */
export const UserCreated = makeEvent({
  name: 'inbox.spec.user-created',
  input: z.object({ id: z.string(), email: z.string() }),
});

/**
 * Соединение с базой. В фикстуре это то же хранилище в памяти: тесту
 * важно, что транзакция и отметки приходят с одного соединения.
 */
@Component([])
export class TestDatabase {
  readonly inbox = new InMemoryInboxStore();

  begin(): TestTransaction {
    return new TestTransaction();
  }
}

/**
 * Слой транзакции: открывает её до хендлера, закрывает после ответа.
 *
 * Писатель получает соединение из контейнера сам: класса-моста, который
 * клал бы его в контекст, не нужно.
 */
export const transactional = makePipeline()
  .pre(Tx.provide([TestDatabase], (_ctx, db) => db.begin()))
  .ok((_res, ctx: ExtendableContext<{ tx: TestTransaction }>) => {
    ctx.input.tx.commit();
  })
  .catch((_error, ctx: ExtendableContext<{ tx?: TestTransaction }>) => {
    ctx.input.tx?.rollback();
  });

/** Сколько раз каждый подписчик дошёл до хендлера */
export const handled: { subscriber: string; id: string }[] = [];

/** Хендлер подписчика: считает доставки и может упасть по просьбе payload'а */
export const makeSubscriberHandler =
  (subscriber: string) =>
  async (payload: { id: string; email: string }): Output<undefined> => {
    handled.push({ subscriber, id: payload.id });

    if (payload.email === 'fail@example.com') {
      throw new Error('handler failed after the mark');
    }

    return new Ok(undefined);
  };

/**
 * Инфраструктура базы: соединение и адаптер хранилища.
 *
 * Плагин, а не фича: `inbox(...)` — тоже плагин, и его юнит отметки
 * инжектит `InboxStore$`. DI-токен фичи в зависимостях плагина ронял бы
 * сборку проверкой границы фич.
 */
export const databasePlugin: Plugin = makePlugin({
  name: 'spec:database',
  providers: [
    TestDatabase,
    {
      provide: InboxStore$,
      useFactory: (db: TestDatabase) => db.inbox,
      deps: [TestDatabase],
    },
  ],
});
