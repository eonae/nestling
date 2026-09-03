/**
 * App-тесты: каждый запрос проходит полный пайплайн, сокет не открывается.
 */

import {
  KillSubscription,
  ListSubscriptions,
  WatchSubscriptions,
} from './features/ops/subscriptions.endpoint';
import { ClaimQuotaImpl } from './features/quotas/quotas.feature';
import { ActivityHub } from './features/users/activity.hub';
import {
  ActivityStream,
  CreateUser,
  DeleteUser,
  GetUser,
  ListUsers,
} from './features/users/endpoints';
import { UsersRepository$ } from './features/users/users.repository';
import { type Logger, Logger$, observability } from './plugins/logging';
import { app } from './app';
import { appConfigKeys } from './app.config';
import { ClaimQuota, QuotaExceeded } from './operations';
import { inMemoryUsersRepo } from './testing';

import { describe, expect, it } from '@jest/globals';
import { makeApp } from '@nestling/app';
import { objectSource } from '@nestling/config';
import type { InjectionToken } from '@nestling/container';
import type { OpenApiDocument } from '@nestling/openapi';
import { openapi, OpenApiDocument$ } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';
import { RequestId } from '@nestling/pipeline';
import { SubscriptionRegistry } from '@nestling/subscriptions';
import {
  assembleTest,
  checkTopologies,
  contextValue,
  unwrap,
  vars,
} from '@nestling/testing';
import { HttpTransport$ } from '@nestling/transport.http';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };
const bob = { id: '2', name: 'Bob', email: 'bob@example.com' };

/** Значения секретов для теста: `process.env` тестовая сборка не читает */
const testEnv = { API_TOKEN: 'test-token', WEBHOOK_SECRET: 'test-hook' };

/** Конфиг теста: заменяет привязку декларации, `process.env` не читается */
const testConfig = { config: vars(testEnv) };

/**
 * Декларация для `check()`: подстановок у структурной проверки нет,
 * поэтому значения секретов привязываются источником к ключам секции
 */
const checked = makeApp({
  features: app.spec.features,
  plugins: app.spec.plugins,
  policies: app.spec.policies,
  transports: app.spec.transports,
  config: [[objectSource(testEnv, 'test'), appConfigKeys]],
});

/** Заголовки запроса с верным токеном */
const asClient = { attributes: { authorization: 'Bearer test-token' } };

/** Логгер, который копит строки: по ним тест читает аудит и трассировку */
const spyLogger = (): { lines: string[]; logger: Logger } => {
  const lines: string[] = [];
  const push = (line: string): void => void lines.push(line);

  return { lines, logger: { debug: push, log: push, error: push } };
};

/** Создаёт пользователя через полный пайплайн endpoint'а */
const createUser = (
  testApp: Awaited<ReturnType<typeof assembleTest>>,
  suffix: string,
) =>
  testApp.call(
    CreateUser,
    { name: `User ${suffix}`, email: `user-${suffix}@example.com` },
    asClient,
  );

describe('app-тесты через assembleTest', () => {
  it('вызывает endpoint через полный пайплайн', async () => {
    await using testApp = await assembleTest(app, {
      ...testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
    });

    expect(unwrap(await testApp.call(GetUser, { id: '1' }))).toEqual(alice);
    expect(unwrap(await testApp.call(ListUsers, {}))).toHaveLength(2);
    expect(unwrap(await createUser(testApp, 'carol'))).toMatchObject({
      name: 'User carol',
    });
  });

  it('отдаёт объявленный отказ со статусом и кодом', async () => {
    await using testApp = await assembleTest(app, {
      ...testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice])]],
    });

    expect(await testApp.call(GetUser, { id: '404' })).toMatchObject({
      isSuccess: false,
      status: 'not_found',
      value: { code: 'not_found:user' },
    });
  });

  it('отклоняет запись без токена до вызова хендлера', async () => {
    const repo = inMemoryUsersRepo([alice]);
    await using testApp = await assembleTest(app, {
      ...testConfig,
      overrides: [[UsersRepository$, repo]],
    });

    expect(await testApp.call(DeleteUser, { id: '1' })).toMatchObject({
      isSuccess: false,
      status: 'unauthorized',
      value: { code: 'unauthorized' },
    });
    expect(await repo.byId('1')).toEqual(alice);
  });

  it('не создаёт узлы, которые нужны только подменённому хранилищу', async () => {
    await using testApp = await assembleTest(app, {
      ...testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    // Соединение с базой нужно только боевому хранилищу: после подмены
    // контейнер его не создаёт, и `@OnInit` не вызывается
    expect(testApp.pruned).toContain('Database');
    expect(testApp.get(HttpTransport$('default'))).not.toBeNull();
  });

  it('без overrides собирает граф без выпавших узлов', async () => {
    await using testApp = await assembleTest(app, testConfig);

    expect(testApp.pruned).toEqual([]);
    expect(unwrap(await testApp.call(ListUsers, {}))).toHaveLength(2);
  });
});

describe('асинхронный контекст в глубине графа', () => {
  it('хранилище читает requestId, который положил слой observability', async () => {
    const spy = spyLogger();
    await using testApp = await assembleTest(app, {
      ...testConfig,
      overrides: [[Logger$, spy.logger]],
    });

    unwrap(await testApp.call(GetUser, { id: '1' }));

    // Endpoint вызван без requestId, и параметром он в хранилище не
    // передан: значение прочитано из контекста
    expect(spy.lines).toContainEqual(expect.stringMatching(/^\[.+] byId 1$/));
    expect(spy.lines).not.toContainEqual(expect.stringContaining('[n/a]'));
  });

  it('contextValue подставляет значение переменной в тестовом корне', async () => {
    const spy = spyLogger();
    await using testApp = await assembleTest(app, {
      ...testConfig,
      overrides: [[Logger$, spy.logger], contextValue(RequestId, 'req-fixed')],
    });

    unwrap(await testApp.call(GetUser, { id: '1' }));

    expect(spy.lines).toContain('[req-fixed] byId 1');
  });
});

describe('фичи и плагины в сборке', () => {
  it('подключает плагины и только выбранную фичу', async () => {
    // `ops` выбрана одна: провайдеров фичи `users` в графе нет, а плагины
    // есть в любой сборке
    await using testApp = await assembleTest(app, {
      ...testConfig,
      select: 'ops',
    });

    expect(testApp.get(Logger$)).not.toBeNull();
    expect(testApp.get(SubscriptionRegistry)).not.toBeNull();
    expect(testApp.get(ActivityHub)).toBeNull();
  });

  it('замыкает выбор по вызываемым операциям', async () => {
    await using testApp = await assembleTest(app, {
      ...testConfig,
      select: { features: 'users', includeDeps: true },
    });

    expect(testApp.features).toEqual(['users', 'quotas']);
  });

  it('даёт фичам один экземпляр плагина', async () => {
    await using testApp = await assembleTest(app, testConfig);

    const logger = testApp.get(Logger$);

    expect(logger).not.toBeNull();
    expect(testApp.get(Logger$)).toBe(logger);
  });
});

describe('фичи вызывают друг друга через операции', () => {
  it.each<['local-first' | 'always-remote']>([
    ['local-first'],
    ['always-remote'],
  ])('политика диспатча %s меняет путь вызова, но не код', async (dispatch) => {
    await using testApp = await assembleTest(app, {
      // Политика задаётся конфигом: в тесте через `vars()`, в бою
      // переменной окружения
      config: vars({ ...testEnv, NESTLING_PORTS_DISPATCH: dispatch }),
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    expect(unwrap(await createUser(testApp, dispatch))).toMatchObject({
      name: `User ${dispatch}`,
    });
  });

  it('возвращает отказ соседней фичи при исчерпанной квоте', async () => {
    await using testApp = await assembleTest(app, {
      ...testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    for (const index of [1, 2, 3, 4, 5]) {
      unwrap(await createUser(testApp, String(index)));
    }

    // Отказ прошёл границу вызывающего endpoint'а без замены на
    // `InternalError`: его `errors:` объявляет отказ соседа наравне со своими
    expect(await createUser(testApp, 'sixth')).toMatchObject({
      isSuccess: false,
      status: 'too_many_requests',
      value: { code: QuotaExceeded.code, details: { limit: 5 } },
    });
  });

  it('вызывает реализацию операции так же, как endpoint', async () => {
    await using testApp = await assembleTest(app, testConfig);

    expect(
      unwrap(await testApp.call(ClaimQuotaImpl, { email: 'a@b.c' })),
    ).toEqual({
      remaining: 4,
    });
  });

  it('отказывает по истёкшему deadline, не вызывая реализацию', async () => {
    await using testApp = await assembleTest(app, testConfig);

    // Порт — обычный узел графа: тест достаёт его через `testApp.get`
    const quotas = testApp.get(ClaimQuota.caller);

    const refused = await quotas?.call(
      { email: 'late@example.com' },
      { deadline: new Date(Date.now() - 1) },
    );

    // Код ошибки задаёт ядро, объявлять его в `errors:` не нужно
    expect(refused).toMatchObject({
      code: 'timeout',
    });

    // Реализация не вызывалась, место в квоте не занято
    expect(
      unwrap(await testApp.call(ClaimQuotaImpl, { email: 'a@b.c' })),
    ).toEqual({
      remaining: 4,
    });
  });

  it('доставляет ключ идемпотентности команды до сервиса в глубине', async () => {
    const spy = spyLogger();
    await using testApp = await assembleTest(app, {
      ...testConfig,
      overrides: [
        [UsersRepository$, inMemoryUsersRepo()],
        [Logger$, spy.logger],
      ],
    });

    unwrap(await createUser(testApp, 'signed'));

    // `emit` завершается по доставке, а не по обработке
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Ключом вызывающий задал id пользователя, и журнал получил его
    expect(spy.lines).toContainEqual(
      expect.stringMatching(/^signup (\d+) recorded, intent \1$/),
    );
  });
});

describe('матрица select-топологий', () => {
  it('собирает каждый вариант деплоя без сокетов', async () => {
    const usersWithDeps = { features: 'users', includeDeps: true } as const;
    const reports = await checkTopologies(checked, [
      'all',
      usersWithDeps,
      'ops',
    ]);

    // `users` зовёт `quotas.claim`, поэтому замыкание по операциям тянет
    // фичу квот. `ops` никто не вызывает, и она приходит только явным выбором
    expect(reports[1].report.features).toEqual(['users', 'quotas']);
    expect(
      reports[2].report.endpoints.map(({ pattern }) => pattern).sort(),
    ).toEqual([
      'DELETE /ops/subscriptions/:id',
      'GET /health',
      'GET /openapi.json',
      'GET /ops/subscriptions',
      'GET /ops/subscriptions/live',
      'subscriptions.closed@ops',
      'subscriptions.opened@ops',
    ]);
  });

  it("проверяет политики и перечисляет detached-endpoint'ы в отчёте", async () => {
    const [{ report }] = await checkTopologies(checked, ['all']);

    expect(
      report.endpoints
        .filter(({ detached }) => detached !== undefined)
        .map(({ pattern }) => pattern)
        .sort(),
    ).toEqual(['GET /health', 'POST /hooks/users']);
  });
});

/** Достаёт документ OpenAPI из собранного графа */
const documentOf = (testApp: {
  get: <T>(token: InjectionToken<T>) => T | null;
}): OpenApiDocument => {
  const document = testApp.get(OpenApiDocument$);
  if (!document) {
    throw new Error('OpenApiDocument$ is not in the graph');
  }

  return document;
};

describe('документ OpenAPI', () => {
  /** Та же декларация без вывода списка скрытых endpoint'ов */
  const documented = makeApp({
    features: app.spec.features,
    transports: app.spec.transports,
    policies: app.spec.policies,
    plugins: [
      ...app.spec.plugins.filter(
        (plugin) => plugin.name !== '@nestling/openapi',
      ),
      openapi({
        info: { title: 'Users API', version: '1.0.0' },
        converters: [zodConverter()],
        pipeline: observability,
        announceHidden: false,
      }),
    ],
  });

  it('описывает каждый публичный endpoint и ни одного скрытого', async () => {
    await using testApp = await assembleTest(documented, testConfig);

    const { paths } = documentOf(testApp);

    expect(Object.keys(paths).sort()).toEqual([
      '/hooks/users',
      '/ops/subscriptions',
      '/ops/subscriptions/live',
      '/ops/subscriptions/{id}',
      '/users',
      '/users/activity',
      '/users/export',
      '/users/import',
      '/users/{id}',
      '/users/{id}/avatar',
    ]);
    expect(paths['/health']).toBeUndefined();
    expect(paths['/openapi.json']).toBeUndefined();
  });

  it('берёт имя операции, документацию и bind-карту с операции', async () => {
    await using testApp = await assembleTest(documented, testConfig);

    const { paths } = documentOf(testApp);

    expect(paths['/users'].post).toMatchObject({
      operationId: 'users.create',
      summary: 'Создать пользователя',
      tags: ['users'],
    });
    // `dryRun` описан как query-параметр, а не как поле тела
    expect(
      paths['/users'].post.parameters?.map(({ name, in: where }) => [
        name,
        where,
      ]),
    ).toEqual([['dryRun', 'query']]);
  });

  it('коды ответов совпадают с тем, что отвечает транспорт', async () => {
    await using testApp = await assembleTest(documented, {
      ...testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    const { responses } = documentOf(testApp).paths['/users'].post;

    const created = await createUser(testApp, 'doc');
    expect(created.status).toBe('created');
    expect(responses['201']).toBeDefined();

    const conflict = await createUser(testApp, 'doc');
    expect(conflict.status).toBe('conflict');
    expect(
      (
        responses['409'].content?.['application/json'].schema as {
          properties: { code: { const: string } };
        }
      ).properties.code.const,
    ).toBe('conflict:email_taken');
  });
});

/** Достаёт итератор событий из ответа `events`-endpoint'а */
const streamOf = <T>(response: unknown): AsyncIterableIterator<T> =>
  (response as { value: AsyncIterableIterator<T> }).value;

describe('реестр подписок', () => {
  it('показывает подписку, завершает её и удаляет запись', async () => {
    await using testApp = await assembleTest(app, {
      ...testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    const subscription = streamOf<{ kind: string }>(
      await testApp.call(ActivityStream),
    );

    // Подписка видна в списке до того, как отдан первый элемент
    const [listed] = unwrap(await testApp.call(ListSubscriptions));
    expect(listed).toMatchObject({
      transport: 'http',
      pattern: 'GET /users/activity',
      kind: 'events',
      itemsOut: 0,
    });

    unwrap(await createUser(testApp, 'subscriber'));
    const delivered = await subscription.next();
    expect(delivered.value).toMatchObject({ kind: 'created' });
    expect(unwrap(await testApp.call(ListSubscriptions))[0].itemsOut).toBe(1);

    // Администратор завершает подписку: поток закрывается сам
    const killed = await testApp.call(
      KillSubscription,
      { id: listed.id },
      asClient,
    );
    expect(killed.status).toBe('no_content');

    const tail: unknown[] = [];
    for await (const event of subscription) {
      tail.push(event);
    }
    expect(tail).toEqual([]);

    // Запись снял `.finally` пайплайна, когда поток закрылся
    expect(unwrap(await testApp.call(ListSubscriptions))).toEqual([]);
  });

  it('возвращает объявленный отказ на неизвестную подписку', async () => {
    await using testApp = await assembleTest(app, testConfig);

    expect(
      await testApp.call(KillSubscription, { id: 'unknown' }, asClient),
    ).toMatchObject({
      isSuccess: false,
      status: 'not_found',
      value: { code: 'not_found:subscription' },
    });
  });

  it('лента реестра сама является подпиской и не видит своего opened', async () => {
    await using testApp = await assembleTest(app, testConfig);

    const feed = streamOf<{ type: string; subscription: { pattern: string } }>(
      await testApp.call(WatchSubscriptions),
    );

    expect(
      unwrap(await testApp.call(ListSubscriptions)).map(
        ({ pattern }) => pattern,
      ),
    ).toEqual(['GET /ops/subscriptions/live']);

    await testApp.call(ActivityStream);

    const first = await feed.next();
    expect(first.value).toMatchObject({
      type: 'opened',
      subscription: { pattern: 'GET /users/activity' },
    });

    await feed.return?.();
  });
});
