/**
 * Пакет в собранном приложении: тестовый корень, полный пайплайн, проход
 * уборщика руками.
 *
 * Здесь же живут отрицательные утверждения, ради которых плагин сделан
 * именно так: сообщение без ключа роняет обработку, слой снаружи
 * транзакции падает понятно, а подписчик без слоя не проходит политику.
 */

import {
  databasePlugin,
  handled,
  InboxStore$,
  makeSubscriberHandler,
  TestDatabase,
  transactional,
  UserCreated,
} from './__fixtures__/app.js';
import { Tx } from './__fixtures__/transaction.js';
import { testTransport } from './__fixtures__/transport.js';
import type { InMemoryInboxStore } from './memory-store.js';
import { inbox } from './plugin.js';
import { InboxSweeper$ } from './sweeper.js';

import { beforeEach, describe, expect, it } from '@jest/globals';
import type { AnyEndpointDefinition, App, Policy } from '@nestlingjs/app';
import { compose, implement, makeApp, makeFeature } from '@nestlingjs/app';
import type { TestApp } from '@nestlingjs/testing';
import { assembleTest, vars } from '@nestlingjs/testing';

/** Плагин приёма: один экземпляр на все сборки этого файла */
const appInbox = inbox({ transaction: Tx, store: InboxStore$ });

/** Слой подписчика: приём внутри транзакции */
const guarded = compose(transactional, appInbox.layer);

/** Первый подписчик события */
const WelcomeEmail = implement(UserCreated, {
  subscriber: 'welcome-email',
  pipeline: guarded,
  handler: makeSubscriberHandler('welcome-email'),
});

/** Второй подписчик того же события: своя отметка, свой счёт */
const Analytics = implement(UserCreated, {
  subscriber: 'analytics',
  pipeline: guarded,
  handler: makeSubscriberHandler('analytics'),
});

/** Подписчик со слоем приёма снаружи транзакции */
const Detached = implement(UserCreated, {
  subscriber: 'detached',
  pipeline: compose(appInbox.layer, transactional),
  handler: makeSubscriberHandler('detached'),
});

/** Подписчик вовсе без слоя приёма — предмет политики предпосылки */
const Bare = implement(UserCreated, {
  subscriber: 'bare',
  pipeline: transactional,
  handler: makeSubscriberHandler('bare'),
});

const application = (
  endpoints: readonly AnyEndpointDefinition[] = [WelcomeEmail, Analytics],
  policies: readonly Policy[] = [],
): App =>
  makeApp({
    features: [makeFeature({ name: 'users', endpoints })],
    plugins: [databasePlugin, appInbox],
    transports: [testTransport()],
    policies: [...policies],
  });

/** Хранилище собранного приложения */
function storeOf(app: TestApp): InMemoryInboxStore {
  const db = app.get(TestDatabase);

  if (!db) {
    throw new Error('в графе нет соединения с базой');
  }

  return db.inbox;
}

/** Доставляет событие подписчику так, как это сделал бы транспорт */
const deliver = async (
  app: TestApp,
  endpoint: AnyEndpointDefinition,
  payload: { id: string; email: string },
  idempotencyKey: string,
) => app.call(endpoint, payload, { attributes: { idempotencyKey } });

describe('inbox(): пакет в собранном приложении', () => {
  beforeEach(() => {
    handled.length = 0;
  });

  it('повтор не доходит до хендлера', async () => {
    await using app = await assembleTest(application());
    const payload = { id: 'u-1', email: 'alice@example.com' };

    const first = await deliver(app, WelcomeEmail, payload, 'k-1');
    const second = await deliver(app, WelcomeEmail, payload, 'k-1');

    expect(first.isSuccess).toBe(true);
    expect(second.isSuccess).toBe(true);
    expect(handled).toEqual([{ subscriber: 'welcome-email', id: 'u-1' }]);
  });

  it('откат хендлера убирает отметку', async () => {
    await using app = await assembleTest(application());
    const payload = { id: 'u-2', email: 'fail@example.com' };

    const failed = await deliver(app, WelcomeEmail, payload, 'k-2');

    expect(failed.isSuccess).toBe(false);
    expect(
      storeOf(app).has('inbox.spec.user-created@welcome-email', 'k-2'),
    ).toBe(false);

    // Повторная доставка обрабатывается заново
    const retry = await deliver(
      app,
      WelcomeEmail,
      { id: 'u-2', email: 'alice@example.com' },
      'k-2',
    );

    expect(retry.isSuccess).toBe(true);
    expect(handled).toHaveLength(2);
  });

  it('два подписчика дедуплицируют независимо', async () => {
    await using app = await assembleTest(application());
    const payload = { id: 'u-3', email: 'carol@example.com' };

    await deliver(app, WelcomeEmail, payload, 'k-3');
    await deliver(app, Analytics, payload, 'k-3');
    await deliver(app, WelcomeEmail, payload, 'k-3');

    expect(handled).toEqual([
      { subscriber: 'welcome-email', id: 'u-3' },
      { subscriber: 'analytics', id: 'u-3' },
    ]);
    expect(storeOf(app).size).toBe(2);
  });

  it('сообщение без ключа роняет обработку с обеими починками', async () => {
    await using app = await assembleTest(application());

    const response = await app.call(
      WelcomeEmail,
      { id: 'u-4', email: 'dave@example.com' },
      { attributes: {} },
    );

    expect(response.isSuccess).toBe(false);
    expect(handled).toEqual([]);
    expect(storeOf(app).size).toBe(0);

    const { error } = (response as { value: { error: string } }).value;
    expect(error).toContain('publisher pass an idempotency key');
    expect(error).toContain('outbox');
  });

  it('слой снаружи транзакции падает понятно', async () => {
    await using app = await assembleTest(application([Detached]));

    const response = await app.call(
      Detached,
      { id: 'u-5', email: 'eve@example.com' },
      { attributes: { idempotencyKey: 'k-5' } },
    );

    expect(response.isSuccess).toBe(false);
    expect(handled).toEqual([]);
    expect((response as { value: { error: string } }).value.error).toContain(
      "'tx'",
    );
  });

  it('процесс без уборщика ставит отметки и не запускает задачу', async () => {
    await using app = await assembleTest(application(), {
      config: vars({ INBOX_SWEEP: 'false' }),
    });

    await deliver(
      app,
      WelcomeEmail,
      { id: 'u-6', email: 'frank@example.com' },
      'k-6',
    );

    expect(app.get(InboxSweeper$)?.enabled).toBe(false);
    expect(storeOf(app).size).toBe(1);
  });

  it('проход уборщика делается без таймера', async () => {
    await using app = await assembleTest(application(), {
      config: vars({ INBOX_RETENTION_MS: '0' }),
    });

    await deliver(
      app,
      WelcomeEmail,
      { id: 'u-7', email: 'grace@example.com' },
      'k-7',
    );

    expect(storeOf(app).size).toBe(1);

    // Проход удаляет отметки строго старше границы, поэтому часам нужно
    // сдвинуться хотя бы на миллисекунду
    await new Promise((resolve) => setTimeout(resolve, 2));

    await expect(app.get(InboxSweeper$)?.sweepOnce()).resolves.toBe(1);
    expect(storeOf(app).size).toBe(0);
  });
});

describe('inbox(): отказы объявления и сборки', () => {
  it('не переменная в поле transaction отвергается сразу', () => {
    expect(() =>
      inbox({ transaction: 'tx' as never, store: InboxStore$ }),
    ).toThrow(/context variable value/);
  });

  it('два экземпляра плагина роняют сборку', async () => {
    const twice = makeApp({
      features: [makeFeature({ name: 'users', endpoints: [WelcomeEmail] })],
      plugins: [
        databasePlugin,
        appInbox,
        inbox({ transaction: Tx, store: InboxStore$ }),
      ],
      transports: [testTransport()],
    });

    await expect(assembleTest(twice)).rejects.toThrow(
      /Two different plugins are named '@nestlingjs\/inbox'/,
    );
  });
});

describe('requiresInbox(): предпосылка проверяется на ASSEMBLE', () => {
  it('подписчик без слоя роняет сборку с перечнем нарушивших', async () => {
    const broken = application(
      [WelcomeEmail, Bare],
      [appInbox.requiresInbox({}, 'inbox')],
    );

    await expect(assembleTest(broken)).rejects.toThrow(
      /inbox\.spec\.user-created@bare/,
    );
  });

  it('все подписчики под слоем — сборка проходит', async () => {
    await using app = await assembleTest(
      application(
        [WelcomeEmail, Analytics],
        [appInbox.requiresInbox({}, 'inbox')],
      ),
    );

    expect(app.features).toContain('users');
  });
});
