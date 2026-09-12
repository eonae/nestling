/**
 * Одни и те же декларации фич поднимаются в двух процессах и в одном.
 *
 * Оба сценария собираются одним корнем. Отличается только `select`; ни
 * одна декларация `implement(...)` и ни один вызов порта между ними не
 * различаются.
 */

import { declareApp } from './app.js';

import { describe, expect, it, jest } from '@jest/globals';
import type { AssembledApp } from '@nestlingjs/app';
import { spyLogger } from '@nestlingjs/testing';
import { NatsBus } from '@nestlingjs/transport.nats';
import { NatsDouble, natsDouble } from '@nestlingjs/transport.nats/testing';

/** Арендатор из конверта сообщения, отправленного на этот subject */
function tenantOf(broker: NatsDouble, subject: string): unknown {
  const sent = broker.published.find((item) => item.subject === subject);
  const context = sent?.headers?.get('Nl-Ctx');

  return context
    ? (JSON.parse(context) as { tenantId?: string }).tenantId
    : undefined;
}

/**
 * Ждёт сообщение с этим subject на брокере.
 *
 * Доставка между процессами идёт через асинхронные хендлеры и
 * потребителя JetStream, а у двойника брокера нет способа дождаться
 * простоя. Поэтому тест ждёт наблюдаемое следствие, а не фиксированное
 * время.
 */
async function untilPublished(
  broker: NatsDouble,
  subject: string,
): Promise<void> {
  const deadline = Date.now() + 1000;

  while (!broker.published.some((item) => item.subject === subject)) {
    if (Date.now() > deadline) {
      throw new Error(`no message on '${subject}' within 1s`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

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

/** Поднимает по процессу на каждый `select` и останавливает их вместе */
async function run(
  broker: NatsDouble,
  ...selects: string[]
): Promise<{ close: () => Promise<void> }> {
  const apps: AssembledApp[] = selects.map((select) =>
    // Порт `0` — эфемерный: два процесса одного теста поднимают по
    // серверу метрик, и фиксированный порт занял бы первый из них
    declareApp({ nats: { connect: natsDouble(broker) }, httpPort: 0 }).assemble(
      select,
    ),
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

describe('split-развёртывание через NATS', () => {
  it('два процесса общаются операциями через брокер', async () => {
    const broker = new NatsDouble();
    // Владелец поднимается первым: у брокера нет очереди ожидания для
    // запроса-ответа, и вызов к фиче, которой нет нигде, отказ доставки
    const topology = await run(broker, 'quotas', 'users');
    const outside = await outsideClient(broker);

    await outside.publish(
      'users.register',
      { email: 'alice@example.com' },
      { context: { tenantId: 'acme' } },
    );
    await untilPublished(broker, 'users.registered');

    // Вызов `quotas.claim` ушёл на брокер: владельца в процессе `users` нет
    expect(broker.published.map(({ subject }) => subject)).toEqual(
      expect.arrayContaining([
        'users.register',
        'quotas.claim',
        'users.registered',
      ]),
    );

    // Арендатор прошёл два перехода: процесс `users` прочитал его из
    // конверта юнитом `propagated()`, а вызыватель положил в следующий
    expect(tenantOf(broker, 'quotas.claim')).toBe('acme');
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
      { email: 'bob@example.com' },
      { context: { tenantId: 'acme' } },
    );
    await untilPublished(broker, 'users.registered');

    const subjects = broker.published.map(({ subject }) => subject);

    expect(subjects).toEqual(
      expect.arrayContaining(['users.register', 'users.registered']),
    );
    // Владелец `quotas.claim` работает в этом же процессе, и вызов на
    // брокер не выходит
    expect(subjects).not.toContain('quotas.claim');

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
      const topology = await run(broker, 'quotas', 'users');
      const outside = await outsideClient(broker);

      await outside.publish(
        'users.register',
        { email: 'carol@example.com' },
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

    const users = records.find(({ msg }) => msg === 'register');
    const quotas = records.find(({ msg }) => msg === 'claim');

    // Трасса началась в процессе `users` и продолжилась в `quotas`: её
    // привёз конверт вызова, а базовый слой вернул в контекст
    expect(users?.traceId).toMatch(/^[\da-f]{32}$/);
    expect(quotas?.traceId).toBe(users?.traceId);
  });

  it('процесс users собирается без владельца quotas.claim', async () => {
    const broker = new NatsDouble();

    // Реализации `quotas.claim` в этой сборке нет, и это не ошибка сборки:
    // назначенный интерком доставляет вызов в другой процесс
    const topology = await run(broker, 'users');

    await topology.close();
  });
});
