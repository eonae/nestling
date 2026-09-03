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
import { appConfigKeys } from './app.config';
import { ClaimQuota, QuotaExceeded } from './operations';
import { rootSpec } from './root';
import { inMemoryUsersRepo } from './testing';

import { describe, expect, it } from '@jest/globals';
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
import { http, HttpTransport$ } from '@nestling/transport.http';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };
const bob = { id: '2', name: 'Bob', email: 'bob@example.com' };

/** Значения секретов для теста: `process.env` тестовая сборка не читает */
const testEnv = { API_TOKEN: 'test-token', WEBHOOK_SECRET: 'test-hook' };

/** Тот же словарь, что в `main.ts`: порт `0` и конфиг из объекта */
const spec = {
  ...rootSpec,
  transports: [http({ port: 0 })],
  config: vars(testEnv),
};

/**
 * Словарь для `check()`: у структурной проверки поле `config` то же, что у
 * `assemble`, поэтому значения привязываются источником к ключам секции
 */
const topologySpec = {
  ...rootSpec,
  transports: [http({ port: 0 })],
  config: [[objectSource(testEnv, 'test'), appConfigKeys]] as const,
};

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
  app: Awaited<ReturnType<typeof assembleTest>>,
  suffix: string,
) =>
  app.call(
    CreateUser,
    { name: `User ${suffix}`, email: `user-${suffix}@example.com` },
    asClient,
  );

describe('app-тесты через assembleTest', () => {
  it('вызывает endpoint через полный пайплайн', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
    });

    expect(unwrap(await app.call(GetUser, { id: '1' }))).toEqual(alice);
    expect(unwrap(await app.call(ListUsers, {}))).toHaveLength(2);
    expect(unwrap(await createUser(app, 'carol'))).toMatchObject({
      name: 'User carol',
    });
  });

  it('отдаёт объявленный отказ со статусом и кодом', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice])]],
    });

    expect(await app.call(GetUser, { id: '404' })).toMatchObject({
      isSuccess: false,
      status: 'NOT_FOUND',
      value: { code: 'USER_NOT_FOUND' },
    });
  });

  it('отклоняет запись без токена до вызова хендлера', async () => {
    const repo = inMemoryUsersRepo([alice]);
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository$, repo]],
    });

    expect(await app.call(DeleteUser, { id: '1' })).toMatchObject({
      isSuccess: false,
      status: 'UNAUTHORIZED',
      value: { code: 'UNAUTHORIZED' },
    });
    expect(await repo.byId('1')).toEqual(alice);
  });

  it('не создаёт узлы, которые нужны только подменённому хранилищу', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    // Соединение с базой нужно только боевому хранилищу: после подмены
    // контейнер его не создаёт, и `@OnInit` не вызывается
    expect(app.pruned).toContain('Database');
    expect(app.get(HttpTransport$('default'))).not.toBeNull();
  });

  it('без overrides собирает граф без выпавших узлов', async () => {
    await using app = await assembleTest(spec);

    expect(app.pruned).toEqual([]);
    expect(unwrap(await app.call(ListUsers, {}))).toHaveLength(2);
  });
});

describe('асинхронный контекст в глубине графа', () => {
  it('хранилище читает requestId, который положил слой observability', async () => {
    const spy = spyLogger();
    await using app = await assembleTest({
      ...spec,
      overrides: [[Logger$, spy.logger]],
    });

    unwrap(await app.call(GetUser, { id: '1' }));

    // Endpoint вызван без requestId, и параметром он в хранилище не
    // передан: значение прочитано из контекста
    expect(spy.lines).toContainEqual(expect.stringMatching(/^\[.+] byId 1$/));
    expect(spy.lines).not.toContainEqual(expect.stringContaining('[n/a]'));
  });

  it('contextValue подставляет значение переменной в тестовом корне', async () => {
    const spy = spyLogger();
    await using app = await assembleTest({
      ...spec,
      overrides: [[Logger$, spy.logger], contextValue(RequestId, 'req-fixed')],
    });

    unwrap(await app.call(GetUser, { id: '1' }));

    expect(spy.lines).toContain('[req-fixed] byId 1');
  });
});

describe('фичи и плагины в сборке', () => {
  it('подключает плагины и только выбранную фичу', async () => {
    // `ops` выбрана одна: провайдеров фичи `users` в графе нет, а плагины
    // есть в любой сборке
    await using app = await assembleTest({ ...spec, select: 'ops' });

    expect(app.get(Logger$)).not.toBeNull();
    expect(app.get(SubscriptionRegistry)).not.toBeNull();
    expect(app.get(ActivityHub)).toBeNull();
  });

  it('замыкает выбор по вызываемым операциям', async () => {
    await using app = await assembleTest({
      ...spec,
      select: { features: 'users', includeDeps: true },
    });

    expect(app.features).toEqual(['users', 'quotas']);
  });

  it('даёт фичам один экземпляр плагина', async () => {
    await using app = await assembleTest(spec);

    const logger = app.get(Logger$);

    expect(logger).not.toBeNull();
    expect(app.get(Logger$)).toBe(logger);
  });
});

describe('фичи вызывают друг друга через операции', () => {
  it.each<['local-first' | 'always-remote']>([
    ['local-first'],
    ['always-remote'],
  ])('политика диспатча %s меняет путь вызова, но не код', async (dispatch) => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
      // Политика задаётся конфигом: в тесте через `vars()`, в бою
      // переменной окружения
      config: vars({ ...testEnv, NESTLING_PORTS_DISPATCH: dispatch }),
    });

    expect(unwrap(await createUser(app, dispatch))).toMatchObject({
      name: `User ${dispatch}`,
    });
  });

  it('возвращает отказ соседней фичи при исчерпанной квоте', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    for (const index of [1, 2, 3, 4, 5]) {
      unwrap(await createUser(app, String(index)));
    }

    // Отказ прошёл границу вызывающего endpoint'а без замены на
    // `UnknownError`: его `errors:` объявляет отказ соседа наравне со своими
    expect(await createUser(app, 'sixth')).toMatchObject({
      isSuccess: false,
      status: 'TOO_MANY_REQUESTS',
      value: { code: QuotaExceeded.code, details: { limit: 5 } },
    });
  });

  it('вызывает реализацию операции так же, как endpoint', async () => {
    await using app = await assembleTest(spec);

    expect(unwrap(await app.call(ClaimQuotaImpl, { email: 'a@b.c' }))).toEqual({
      remaining: 4,
    });
  });

  it('отказывает по истёкшему deadline, не вызывая реализацию', async () => {
    await using app = await assembleTest(spec);

    // Порт — обычный узел графа: тест достаёт его через `app.get`
    const quotas = app.get(ClaimQuota.caller);

    const refused = await quotas?.call(
      { email: 'late@example.com' },
      { deadline: new Date(Date.now() - 1) },
    );

    // Код ошибки задаёт ядро, объявлять его в `errors:` не нужно
    expect(refused).toMatchObject({
      status: 'TIMEOUT',
      code: 'DEADLINE_EXCEEDED',
    });

    // Реализация не вызывалась, место в квоте не занято
    expect(unwrap(await app.call(ClaimQuotaImpl, { email: 'a@b.c' }))).toEqual({
      remaining: 4,
    });
  });

  it('доставляет ключ идемпотентности команды до сервиса в глубине', async () => {
    const spy = spyLogger();
    await using app = await assembleTest({
      ...spec,
      overrides: [
        [UsersRepository$, inMemoryUsersRepo()],
        [Logger$, spy.logger],
      ],
    });

    unwrap(await createUser(app, 'signed'));

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
    const reports = await checkTopologies(topologySpec, [
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
    const [{ report }] = await checkTopologies(topologySpec, ['all']);

    expect(
      report.endpoints
        .filter(({ detached }) => detached !== undefined)
        .map(({ pattern }) => pattern)
        .sort(),
    ).toEqual(['GET /health', 'POST /hooks/users']);
  });
});

/** Достаёт документ OpenAPI из собранного графа */
const documentOf = (app: {
  get: <T>(token: InjectionToken<T>) => T | null;
}): OpenApiDocument => {
  const document = app.get(OpenApiDocument$);
  if (!document) {
    throw new Error('OpenApiDocument$ is not in the graph');
  }

  return document;
};

describe('документ OpenAPI', () => {
  /** Словарь сборки без вывода списка скрытых endpoint'ов */
  const documented = {
    ...spec,
    plugins: [
      ...spec.plugins.filter((plugin) => plugin.name !== '@nestling/openapi'),
      openapi({
        info: { title: 'Users API', version: '1.0.0' },
        converters: [zodConverter()],
        pipeline: observability,
        announceHidden: false,
      }),
    ],
  };

  it('описывает каждый публичный endpoint и ни одного скрытого', async () => {
    await using app = await assembleTest(documented);

    const { paths } = documentOf(app);

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
    await using app = await assembleTest(documented);

    const { paths } = documentOf(app);

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
    await using app = await assembleTest({
      ...documented,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    const { responses } = documentOf(app).paths['/users'].post;

    const created = await createUser(app, 'doc');
    expect(created.status).toBe('CREATED');
    expect(responses['201']).toBeDefined();

    const conflict = await createUser(app, 'doc');
    expect(conflict.status).toBe('CONFLICT');
    expect(
      (
        responses['409'].content?.['application/json'].schema as {
          properties: { code: { const: string } };
        }
      ).properties.code.const,
    ).toBe('EMAIL_TAKEN');
  });
});

/** Достаёт итератор событий из ответа `events`-endpoint'а */
const streamOf = <T>(response: unknown): AsyncIterableIterator<T> =>
  (response as { value: AsyncIterableIterator<T> }).value;

describe('реестр подписок', () => {
  it('показывает подписку, завершает её и удаляет запись', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    const subscription = streamOf<{ kind: string }>(
      await app.call(ActivityStream),
    );

    // Подписка видна в списке до того, как отдан первый элемент
    const [listed] = unwrap(await app.call(ListSubscriptions));
    expect(listed).toMatchObject({
      transport: 'http',
      pattern: 'GET /users/activity',
      kind: 'events',
      itemsOut: 0,
    });

    unwrap(await createUser(app, 'subscriber'));
    const delivered = await subscription.next();
    expect(delivered.value).toMatchObject({ kind: 'created' });
    expect(unwrap(await app.call(ListSubscriptions))[0].itemsOut).toBe(1);

    // Администратор завершает подписку: поток закрывается сам
    const killed = await app.call(
      KillSubscription,
      { id: listed.id },
      asClient,
    );
    expect(killed.status).toBe('NO_CONTENT');

    const tail: unknown[] = [];
    for await (const event of subscription) {
      tail.push(event);
    }
    expect(tail).toEqual([]);

    // Запись снял `.finally` пайплайна, когда поток закрылся
    expect(unwrap(await app.call(ListSubscriptions))).toEqual([]);
  });

  it('возвращает объявленный отказ на неизвестную подписку', async () => {
    await using app = await assembleTest(spec);

    expect(
      await app.call(KillSubscription, { id: 'unknown' }, asClient),
    ).toMatchObject({
      isSuccess: false,
      status: 'NOT_FOUND',
      value: { code: 'SUBSCRIPTION_NOT_FOUND' },
    });
  });

  it('лента реестра сама является подпиской и не видит своего opened', async () => {
    await using app = await assembleTest(spec);

    const feed = streamOf<{ type: string; subscription: { pattern: string } }>(
      await app.call(WatchSubscriptions),
    );

    expect(
      unwrap(await app.call(ListSubscriptions)).map(({ pattern }) => pattern),
    ).toEqual(['GET /ops/subscriptions/live']);

    await app.call(ActivityStream);

    const first = await feed.next();
    expect(first.value).toMatchObject({
      type: 'opened',
      subscription: { pattern: 'GET /users/activity' },
    });

    await feed.return?.();
  });
});
