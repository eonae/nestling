/**
 * Пакет в собранном приложении: тестовый корень, полный пайплайн,
 * `drain()` руками.
 *
 * Здесь же живут отрицательные утверждения, ради которых плагин сделан
 * именно так: операция не из списка роняет сборку, два экземпляра плагина
 * роняют её же, endpoint без транзакции не проходит политику, а
 * приложение без шины падает с обеими починками.
 */

import {
  CreateUser,
  databasePlugin,
  DeleteUser,
  OutboxStore$,
  PingUser,
  TestDatabase,
  UserCreated,
} from './__fixtures__/app.js';
import { Tx } from './__fixtures__/transaction.js';
import { testTransport } from './__fixtures__/transport.js';
import type { InMemoryOutboxStore } from './memory-store.js';
import { outbox } from './plugin.js';
import { OutboxRelay$ } from './relay.js';

import { describe, expect, it } from '@jest/globals';
import type { App, Output } from '@nestling/app';
import {
  implement,
  makeApp,
  makeFeature,
  makePipeline,
  withIdempotencyKey,
} from '@nestling/app';
import { Ok } from '@nestling/operations';
import type { TestApp } from '@nestling/testing';
import { assembleTest, vars } from '@nestling/testing';

/** Подписчики события; наполняется прямым эмиттером и relay */
const delivered: { id: string; idempotencyKey?: string }[] = [];

/**
 * Подписчик события: он же ставит шину в граф.
 *
 * Ключ идемпотентности читает штатный писатель ядра: у события
 * типизированного `meta.idempotencyKey` нет, и ключ приходит транспортным
 * атрибутом конверта.
 */
const AuditUserCreated = implement(UserCreated, {
  subscriber: 'audit',
  pipeline: makePipeline().pre(withIdempotencyKey()),
  handler: async (
    payload: { id: string; email: string },
    meta: { idempotencyKey: string },
  ): Output<undefined> => {
    delivered.push({ id: payload.id, idempotencyKey: meta.idempotencyKey });

    return new Ok(undefined);
  },
});

/** Фича бизнес-логики: только endpoint'ы, инфраструктура — в плагине */
const usersFeature = makeFeature({
  name: 'users',
  endpoints: [CreateUser, AuditUserCreated],
});

/** Приложение с outbox'ом; список операций плагину передаётся явно */
const application = (): App =>
  makeApp({
    features: [usersFeature],
    plugins: [
      databasePlugin,
      outbox({
        transaction: Tx,
        store: OutboxStore$,
        operations: [UserCreated],
        partitionKey: (payload) => (payload as { id: string }).id,
      }),
    ],
    transports: [testTransport()],
  });

/** Хранилище собранного приложения */
function storeOf(app: TestApp): InMemoryOutboxStore {
  const db = app.get(TestDatabase);

  if (!db) {
    throw new Error('в графе нет соединения с базой');
  }

  return db.outbox;
}

describe('outbox(): пакет в собранном приложении', () => {
  it('пишет запись в транзакции запроса и не публикует её сразу', async () => {
    delivered.length = 0;
    await using app = await assembleTest(application());

    const response = await app.call(CreateUser, {
      id: 'u-1',
      email: 'alice@example.com',
    });

    expect(response.isSuccess).toBe(true);

    const store = storeOf(app);

    // Прямой эмиттер доставил сразу, транзакционный — только записал
    expect(delivered).toHaveLength(1);
    expect(delivered[0].id).toBe('u-1');
    expect(store.snapshot()).toHaveLength(1);
    expect(store.snapshot()[0].record.subject).toBe(UserCreated.name);
  });

  it('relay публикует запись, и подписчик видит ключ идемпотентности', async () => {
    delivered.length = 0;
    await using app = await assembleTest(application());

    await app.call(CreateUser, { id: 'u-2', email: 'bob@example.com' });

    const relay = app.get(OutboxRelay$);
    expect(relay).not.toBeNull();

    const report = await relay?.drain();

    expect(report).toMatchObject({ claimed: 1, published: 1 });

    const [, republished] = delivered;
    const [{ record }] = storeOf(app).snapshot();

    expect(republished).toEqual({ id: 'u-2', idempotencyKey: record.id });
  });

  it('откат транзакции убирает запись', async () => {
    delivered.length = 0;
    await using app = await assembleTest(application());

    const response = await app.call(CreateUser, {
      id: 'u-3',
      email: 'carol@example.com',
      fail: true,
    });

    expect(response.isSuccess).toBe(false);
    expect(storeOf(app).snapshot()).toHaveLength(0);
  });

  it('приложение без подписчиков на факты собирается и работает', async () => {
    await using app = await assembleTest(application());

    await app.call(CreateUser, { id: 'u-4', email: 'dave@example.com' });

    await expect(app.get(OutboxRelay$)?.drain()).resolves.toMatchObject({
      published: 1,
    });
  });

  it('процесс с выключенным relay пишет записи и не запускает задачу', async () => {
    await using app = await assembleTest(application(), {
      config: vars({ OUTBOX_RELAY: 'false' }),
    });

    await app.call(CreateUser, { id: 'u-5', email: 'eve@example.com' });

    expect(app.get(OutboxRelay$)?.enabled).toBe(false);
    expect(storeOf(app).snapshot()).toHaveLength(1);
  });
});

describe('outbox(): отказы сборки', () => {
  it('операция не перечислена — сборка падает с починкой', async () => {
    const broken = makeApp({
      features: [
        makeFeature({
          name: 'users',
          endpoints: [DeleteUser, AuditUserCreated],
        }),
      ],
      plugins: [
        databasePlugin,
        outbox({
          transaction: Tx,
          store: OutboxStore$,
          operations: [UserCreated],
        }),
      ],
      transports: [testTransport()],
    });

    await expect(assembleTest(broken)).rejects.toThrow(
      /plugin\.spec\.user-deleted.*outbox\({ operations }\)/s,
    );
  });

  it('два экземпляра плагина роняют сборку', async () => {
    const twice = makeApp({
      features: [usersFeature],
      plugins: [
        databasePlugin,
        outbox({ transaction: Tx, store: OutboxStore$, operations: [] }),
        outbox({ transaction: Tx, store: OutboxStore$, operations: [] }),
      ],
      transports: [testTransport()],
    });

    // Проверка имён единиц срабатывает раньше повторной регистрации
    // рецепта семейства, но запрещает ровно то же: двух плагинов outbox'а
    // в приложении быть не может
    await expect(assembleTest(twice)).rejects.toThrow(
      /Two different plugins are named '@nestling\/outbox'/,
    );
  });

  it('приложение без шины падает с обеими починками', async () => {
    const busless = makeApp({
      features: [makeFeature({ name: 'users', endpoints: [PingUser] })],
      plugins: [
        databasePlugin,
        outbox({ transaction: Tx, store: OutboxStore$, operations: [] }),
      ],
      transports: [testTransport()],
    });

    await expect(assembleTest(busless)).rejects.toThrow(
      /MessageBus.*bus transport.*remove the outbox plugin/s,
    );
  });

  it('операция вида request в списке отвергается при объявлении', () => {
    expect(() =>
      outbox({
        transaction: Tx,
        store: OutboxStore$,
        operations: [{ name: 'x', kind: 'request' } as never],
      }),
    ).toThrow(/not a command or an event/);
  });
});

describe('requiresTransaction(): предпосылка проверяется на ASSEMBLE', () => {
  it('endpoint без слоя транзакции роняет сборку', async () => {
    const app = makeApp({
      features: [
        makeFeature({
          name: 'users',
          endpoints: [CreateUser, PingUser, AuditUserCreated],
        }),
      ],
      plugins: [
        databasePlugin,
        outbox({
          transaction: Tx,
          store: OutboxStore$,
          operations: [UserCreated],
        }),
      ],
      transports: [testTransport()],
      policies: [
        outbox({
          transaction: Tx,
          store: OutboxStore$,
          operations: [UserCreated],
        }).requiresTransaction({ pattern: /^POST / }),
      ],
    });

    await expect(assembleTest(app)).rejects.toThrow(/POST ping/);
  });

  it('endpoint со слоем транзакции политику проходит', async () => {
    const declaration = outbox({
      transaction: Tx,
      store: OutboxStore$,
      operations: [UserCreated],
    });

    await using app = await assembleTest(
      makeApp({
        features: [usersFeature],
        plugins: [databasePlugin, declaration],
        transports: [testTransport()],
        policies: [declaration.requiresTransaction({ pattern: /^POST / })],
      }),
    );

    expect(app.features).toContain('users');
  });
});
