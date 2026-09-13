/**
 * Одни и те же декларации фич поднимаются в двух процессах и в одном.
 *
 * Оба сценария собираются одним корнем. Отличается только аргумент
 * сборки; ни одна декларация `implement(...)` и ни один вызов порта между
 * ними не различаются.
 */

import { declareApp } from './app.js';
import { describeWithDatabase, TEST_DATABASE_URL, waitFor } from './testing.js';

import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import type { AssembledApp } from '@nestlingjs/app';
import { spyLogger } from '@nestlingjs/testing';
import { NatsBus } from '@nestlingjs/transport.nats';
import { NatsDouble, natsDouble } from '@nestlingjs/transport.nats/testing';
import { Pool } from 'pg';

/** Пул уборки: тесты работают с приложением снаружи */
let pool: Pool | undefined;

/** Арендатор из конверта сообщения, отправленного на этот subject */
function tenantOf(broker: NatsDouble, subject: string): unknown {
  const sent = broker.published.find((item) => item.subject === subject);
  const context = sent?.headers?.get('Nl-Ctx');

  return context
    ? (JSON.parse(context) as { tenantId?: string }).tenantId
    : undefined;
}

/** Ждёт сообщение с этим subject на брокере */
const untilPublished = (broker: NatsDouble, subject: string): Promise<void> =>
  waitFor(
    () => broker.published.some((item) => item.subject === subject),
    `сообщение на '${subject}'`,
    2000,
  );

/** Внешний клиент: кладёт команду на шину */
async function outsideClient(broker: NatsDouble): Promise<NatsBus> {
  // Отказы доставки внешнего клиента тест не читает: записи копит шпион
  const bus = new NatsBus({
    connect: natsDouble(broker),
    logger: spyLogger().logger,
  });
  await bus.connect();

  return bus;
}

/** Поднимает по процессу на каждый аргумент сборки и останавливает их вместе */
async function run(
  broker: NatsDouble,
  ...args: string[]
): Promise<{ close: () => Promise<void> }> {
  const apps: AssembledApp[] = args.map((selection) =>
    // Порт `0` — эфемерный: два процесса одного теста поднимают по
    // серверу проб, и фиксированный порт занял бы первый из них
    declareApp({
      nats: { connect: natsDouble(broker) },
      httpPort: 0,
      databaseUrl: TEST_DATABASE_URL,
    }).assemble(selection),
  );

  for (const app of apps) {
    await app.run();
  }

  return {
    close: async () => {
      for (const app of apps.reverse()) {
        await app.close();
      }
    },
  };
}

/**
 * Перехватывает строки `stderr` на время вызова и разбирает их как JSON.
 *
 * Логгер ядра — единственное место, которое пишет в поток процесса, и
 * поле `traceId` ставит именно он: узлом графа он не является и читает
 * трассу из контекста запроса сам.
 */
async function captureLog(
  body: () => Promise<void>,
): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  const spy = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));

      return true;
    });

  try {
    await body();
  } finally {
    spy.mockRestore();
  }

  return lines
    .join('')
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describeWithDatabase('split-развёртывание через NATS', () => {
  beforeEach(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query('delete from "outbox"');
    await pool.query('delete from "inbox"');
    await pool.query('delete from "users"');
  });

  afterEach(async () => {
    await pool?.end();
    pool = undefined;
  });

  it('два процесса общаются операциями через брокер', async () => {
    const broker = new NatsDouble();
    // Владелец поднимается первым: у брокера нет очереди ожидания для
    // запроса-ответа, и вызов к фиче, которой нет нигде, отказ доставки
    const topology = await run(broker, 'notifications', 'users');
    const outside = await outsideClient(broker);

    await outside.publish(
      'users.register',
      { name: 'Alice', email: 'alice@example.com' },
      { context: { tenantId: 'acme' } },
    );
    await untilPublished(broker, 'users.registered');

    // Вызов `notifications.check-address` ушёл на брокер: владельца в
    // процессе `users` нет
    expect(broker.published.map(({ subject }) => subject)).toEqual(
      expect.arrayContaining([
        'users.register',
        'notifications.check-address',
        'users.registered',
      ]),
    );

    // Арендатор прошёл два перехода: процесс `users` прочитал его из
    // конверта юнитом `propagated()`, а вызыватель положил в следующий
    expect(tenantOf(broker, 'notifications.check-address')).toBe('acme');
    expect(tenantOf(broker, 'users.registered')).toBe('acme');

    // Событие объявлено `durable`, поэтому под ним есть поток JetStream
    const manager = await broker.jetstreamManager();
    await expect(
      manager.streams.info('nestling_users_registered'),
    ).resolves.toMatchObject({ config: { subjects: ['users.registered'] } });

    await outside.close();
    await topology.close();
  });

  it('те же декларации работают в одном процессе', async () => {
    const broker = new NatsDouble();
    const topology = await run(broker, 'all');
    const outside = await outsideClient(broker);

    await outside.publish(
      'users.register',
      { name: 'Bob', email: 'bob@example.com' },
      { context: { tenantId: 'acme' } },
    );
    await untilPublished(broker, 'users.registered');

    const subjects = broker.published.map(({ subject }) => subject);

    expect(subjects).toEqual(
      expect.arrayContaining(['users.register', 'users.registered']),
    );
    // Владелец `notifications.check-address` работает в этом же процессе,
    // и вызов на брокер не выходит
    expect(subjects).not.toContain('notifications.check-address');

    await outside.close();
    await topology.close();
  });

  it('записи двух процессов несут один traceId', async () => {
    const broker = new NatsDouble();

    // Формат `json` и уровень `info` задаются окружением: секция логгера
    // читается на фазе 0, до контейнера
    const previous = process.env.NESTLING_LOG_FORMAT;
    process.env.NESTLING_LOG_FORMAT = 'json';

    const records = await captureLog(async () => {
      const topology = await run(broker, 'notifications', 'users');
      const outside = await outsideClient(broker);

      await outside.publish(
        'users.register',
        { name: 'Carol', email: 'carol@example.com' },
        { context: { tenantId: 'acme' } },
      );
      await untilPublished(broker, 'users.registered');

      await outside.close();
      await topology.close();
    });

    if (previous === undefined) {
      delete process.env.NESTLING_LOG_FORMAT;
    } else {
      process.env.NESTLING_LOG_FORMAT = previous;
    }

    const sent = records.find(({ msg }) => msg === 'register');
    const mailed = records.find(({ msg }) => msg === 'mail sent');

    // Трасса началась в процессе `users` и продолжилась в
    // `notifications`: её привёз конверт вызова, а базовый слой вернул в
    // контекст
    expect(sent?.traceId).toMatch(/^[\da-f]{32}$/);
    expect(mailed?.traceId).toBe(sent?.traceId);
  });

  it('процесс users собирается без владельца notifications.check-address', async () => {
    const broker = new NatsDouble();

    // Реализации `notifications.check-address` в этой сборке нет, и это не
    // ошибка сборки: назначенный интерком доставляет вызов в другой процесс
    const topology = await run(broker, 'users');

    await topology.close();
  });
});
