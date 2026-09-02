/**
 * App-тесты примера: каждый запрос проходит полный пайплайн, но сокет
 * не открывается.
 *
 * Это уровень между юнит-тестами и e2e. Слои пайплайна, валидация схем
 * и проверка объявленных отказов на границе endpoint'а отрабатывают
 * целиком, транспорт не начинает принимать запросы, `process.env` не
 * читается. Подменяется один узел графа: репозиторий пользователей.
 */

import { ILogger, observability } from './modules/logger';
import {
  KillSubscription,
  ListSubscriptions,
  WatchSubscriptions,
} from './modules/ops/subscriptions.endpoint';
import { ClaimQuotaImpl } from './modules/quotas/quotas.feature';
import { ActivityHub } from './modules/users/activity.hub';
import {
  ActivityStream,
  CreateUser,
  DeleteUser,
  GetUser,
  ListUsers,
} from './modules/users/endpoints';
import { OpsFeature, QuotasFeature, UsersFeature } from './features';
import { appLogging, appSubscriptions } from './infrastructure';
import { ClaimQuota, QuotaExceeded } from './operations';
import { inMemoryUsersRepo, UsersRepository } from './testing';

import { describe, expect, it } from '@jest/globals';
import type { InjectionToken } from '@nestling/container';
import type { OpenApiDocument } from '@nestling/openapi';
import { openapi, OpenApiDocument$ } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';
import { everyEndpoint, RequestId } from '@nestling/pipeline';
import { SubscriptionRegistry } from '@nestling/subscriptions';
import {
  assembleTest,
  checkTopologies,
  contextValue,
  unwrap,
  vars,
} from '@nestling/testing';
import { http, HttpTransport$ } from '@nestling/transport.http';

/**
 * Описание сборки: те же фичи, транспорты и политики, что в `main.ts`.
 * Транспорт в app-тесте сокет не открывает.
 */
const spec = {
  features: [UsersFeature, OpsFeature, QuotasFeature],
  plugins: [appLogging, appSubscriptions],
  transports: [http({ port: 0 })],
  // Политики те же, что в `main.ts`: тестовая сборка их не ослабляет
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    everyEndpoint({ transport: HttpTransport$('default') }).hasVar(
      RequestId,
      'requestId',
    ),
  ],
};

describe('пример: app-тесты через assembleTest', () => {
  it('вызывает endpoint через полный пайплайн', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
      config: vars({ HTTP_PORT: '0' }),
    });

    expect(unwrap(await app.call(GetUser, { id: '1' }))).toEqual({
      id: '1',
      name: 'Alice',
      email: 'alice@example.com',
    });

    expect(unwrap(await app.call(ListUsers))).toHaveLength(2);

    const created = unwrap(
      await app.call(CreateUser, {
        name: 'Charlie',
        email: 'charlie@example.com',
      }),
    );
    expect(created).toMatchObject({ name: 'Charlie' });
  });

  it('отдаёт объявленный отказ со статусом и кодом', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    expect(await app.call(GetUser, { id: '404' })).toMatchObject({
      isSuccess: false,
      status: 'NOT_FOUND',
      value: { code: 'USER_NOT_FOUND' },
    });

    // Удаление администратора запрещает доменное правило, а не транспорт
    expect(await app.call(DeleteUser, { id: '1' })).toMatchObject({
      isSuccess: false,
      status: 'FORBIDDEN',
      value: { code: 'USER_NOT_DELETABLE' },
    });
  });

  it('показывает выпавший из графа узел', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    // Хранилище использует только боевой репозиторий. После его подмены
    // узел `UsersStore` никому не нужен: контейнер его не создаёт, и
    // соединение не открывается
    expect(app.pruned).toContain('UsersStore');
    expect(app.get(HttpTransport$('default'))).not.toBeNull();
  });

  it('без overrides собирает граф без выпавших узлов', async () => {
    await using app = await assembleTest(spec);

    expect(app.pruned).toEqual([]);
    expect(unwrap(await app.call(ListUsers))).toHaveLength(2);
  });
});

/** Игнорирует записи уровней, которые тест не проверяет */
const drop = (): void => undefined;

/**
 * Логгер-шпион: собирает строки уровня `debug`, которые пишет
 * репозиторий. По ним тест проверяет, какой requestId туда попал.
 */
const spyLogger = () => {
  const lines: string[] = [];

  return {
    lines,
    logger: {
      debug: (...args: unknown[]) => void lines.push(args.join(' ')),
      log: drop,
      error: drop,
    },
  };
};

describe('пример: асинхронный контекст в глубине графа', () => {
  it('репозиторий читает requestId, который положил слой observability', async () => {
    const spy = spyLogger();

    // Репозиторий боевой, подменён только логгер: тест читает то, что
    // репозиторий написал. Значение `requestId` никто не подставляет:
    // его кладёт в контекст слой `observability`
    await using app = await assembleTest({
      ...spec,
      overrides: [[ILogger, spy.logger]],
    });

    unwrap(await app.call(GetUser, { id: '1' }));

    // Endpoint вызван без requestId, и параметром он в сервис не передан.
    // Репозиторий всё равно читает его из контекста и пишет в строку
    expect(spy.lines).toContainEqual(expect.stringMatching(/^\[.+] byId 1$/));
    expect(spy.lines).not.toContainEqual(expect.stringContaining('[n/a]'));
  });

  it('contextValue подставляет значение в тестовом корне', async () => {
    const spy = spyLogger();

    await using app = await assembleTest({
      ...spec,
      overrides: [[ILogger, spy.logger], contextValue(RequestId, 'req-fixed')],
    });

    unwrap(await app.call(GetUser, { id: '1' }));

    // `contextValue` подменяет чтение значения, а не сам контекст:
    // пайплайн по-прежнему кладёт свой requestId, но сервис читает то,
    // что задал тест
    expect(spy.lines).toContain('[req-fixed] byId 1');
  });
});

describe('пример: фича подключает свою инфраструктуру', () => {
  it('подключает ровно ту инфраструктуру, которую фича импортирует', async () => {
    // `ops` импортирует логирование и реестр подписок: её служебные
    // endpoint'ы подчиняются тем же политикам, что и прикладные.
    // Провайдеров фичи `users` в графе нет: её никто не выбрал
    await using app = await assembleTest({ ...spec, select: 'ops' });

    expect(app.get(ILogger)).not.toBeNull();
    expect(app.get(SubscriptionRegistry)).not.toBeNull();
    expect(app.get(ActivityHub)).toBeNull();
    expect(app.get(HttpTransport$('default'))).not.toBeNull();
  });

  it('подключает инфраструктуру выбранной фичи', async () => {
    await using app = await assembleTest({
      ...spec,
      select: { features: 'users', includeDeps: true },
    });

    expect(app.get(ILogger)).not.toBeNull();
    expect(app.get(ActivityHub)).not.toBeNull();
  });

  it('фичи в одном процессе делят инстанс общего модуля', async () => {
    // Логирование — плагин: он подключён всегда и один на процесс, поэтому
    // логгер у фич общий. Второй вызов `logging({ … })` дал бы второе
    // значение под тем же именем, и сборка упала бы на коллизии имён
    await using app = await assembleTest(spec);

    const logger = app.get(ILogger);

    expect(logger).not.toBeNull();
    expect(app.get(ILogger)).toBe(logger);
  });
});

/** Создаёт пользователя через полный пайплайн endpoint'а */
const createUser = (
  app: Awaited<ReturnType<typeof assembleTest>>,
  suffix: string,
) =>
  app.call(CreateUser, {
    name: `User ${suffix}`,
    email: `user-${suffix}@example.com`,
  });

describe('пример: фичи вызывают друг друга через операции', () => {
  it.each<['local-first' | 'always-remote']>([
    ['local-first'],
    ['always-remote'],
  ])('политика %s меняет путь вызова, но не код', async (dispatch) => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
      // Политика диспатча задаётся конфигом: в тесте через `vars()`,
      // в бою переменной окружения или привязанным источником
      config: vars({ NESTLING_PORTS_DISPATCH: dispatch }),
    });

    expect(unwrap(await createUser(app, dispatch))).toMatchObject({
      name: `User ${dispatch}`,
    });
  });

  it('возвращает отказ соседней фичи при исчерпанной квоте', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    // Фича квот выдаёт пять мест
    for (const index of [1, 2, 3, 4, 5]) {
      unwrap(await createUser(app, String(index)));
    }

    const refused = await createUser(app, 'sixth');

    // Отказ прошёл границу вызывающего endpoint'а без замены на
    // `UnknownError`: его `errors` объявляет отказ соседней фичи наравне
    // со своими
    expect(refused).toMatchObject({
      isSuccess: false,
      status: 'TOO_MANY_REQUESTS',
      value: { code: QuotaExceeded.code, details: { limit: 5 } },
    });
  });

  it('вызывает реализацию операции так же, как endpoint', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    // Отдельного механизма нет: та же `app.call` по значению декларации,
    // что и для HTTP-endpoint'а
    expect(unwrap(await app.call(ClaimQuotaImpl, { email: 'a@b.c' }))).toEqual({
      remaining: 4,
    });
  });
});

describe('пример: meta вызова через порт', () => {
  it('отказывает по истёкшему deadline, не вызывая реализацию', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    // Порт — обычный узел графа: в тесте его достают тем же `app.get`,
    // что транспорт или логгер
    const quotas = app.get(ClaimQuota.caller);

    const refused = await quotas?.call(
      { email: 'late@example.com' },
      // Deadline в прошлом: срок истёк ещё до вызова
      { deadline: new Date(Date.now() - 1) },
    );

    // Код ошибки задаёт ядро, а не `UNKNOWN`: `DEADLINE_EXCEEDED` входит
    // в список ответов порта
    expect(refused).toMatchObject({
      status: 'TIMEOUT',
      code: 'DEADLINE_EXCEEDED',
    });

    // Реализация не вызывалась, и место в квоте не занято: следующий
    // вызов видит нетронутый лимит
    expect(unwrap(await app.call(ClaimQuotaImpl, { email: 'a@b.c' }))).toEqual({
      remaining: 4,
    });
  });

  it('передаёт ключ идемпотентности команды до сервиса в глубине', async () => {
    const spy = spyLogger();

    await using app = await assembleTest({
      ...spec,
      overrides: [
        [UsersRepository, inMemoryUsersRepo()],
        [ILogger, spy.logger],
      ],
    });

    unwrap(await createUser(app, 'signed'));

    // `emit` завершается, когда сообщение доставлено, а не обработано
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Ключом идемпотентности вызывающий код задал id пользователя, и
    // журнал получил именно его, а не ключ, сгенерированный эмиттером
    expect(spy.lines).toContainEqual(
      expect.stringMatching(/^signup (\d+) recorded, intent \1$/),
    );
  });
});

describe('пример: матрица select-топологий', () => {
  it('собирает каждый вариант деплоя без сокетов', async () => {
    const usersWithDeps = { features: 'users', includeDeps: true } as const;
    const reports = await checkTopologies(spec, ['all', usersWithDeps, 'ops']);

    expect(reports.map(({ select }) => select)).toEqual([
      'all',
      usersWithDeps,
      'ops',
    ]);

    // `users` зовёт `quotas.claim`, поэтому замыкание по операциям тянет
    // фичу квот. `ops` не тянется: её endpoint'ы служебные, и вызовов из
    // `users` в неё нет
    expect(reports[1].report.features).toEqual(['users', 'quotas']);
    expect(
      reports[2].report.endpoints.map(({ pattern }) => pattern).sort(),
    ).toEqual([
      'DELETE /api/ops/subscriptions/:id',
      'GET /api/ops/subscriptions',
      'GET /api/ops/subscriptions/live',
      'GET /health',
      'subscriptions.closed@ops',
      'subscriptions.opened@ops',
    ]);
    expect(reports[0].report.endpoints.length).toBeGreaterThan(1);
  });

  it('проверяет политики и отдаёт список detached значением из отчёта', async () => {
    const [{ report }] = await checkTopologies(spec, ['all']);

    // `checkTopologies` проверяет `policies` в каждой топологии: тест
    // доходит сюда, только если инвариант соблюдён во всех. Список
    // detached-endpoint'ов сравнивается значением из отчёта, а не по stdout
    expect(
      report.endpoints
        .filter(({ detached }) => detached !== undefined)
        .map(({ pattern, detached }) => ({ pattern, detached })),
    ).toEqual([
      {
        pattern: 'GET /health',
        detached:
          'liveness-проба балансировщика: строка аудита на каждый удар — шум, а не наблюдаемость',
      },
    ]);
  });
});

/**
 * Достаёт документ OpenAPI из собранного графа.
 *
 * Документ выводится из тех же деклараций, которые обслуживают запросы,
 * и строится на фазе ASSEMBLE как обычное значение в графе.
 */
const documentOf = (app: {
  get: <T>(token: InjectionToken<T>) => T | null;
}): OpenApiDocument => {
  const document = app.get(OpenApiDocument$);
  if (!document) {
    throw new Error('OpenApiDocument$ is not in the graph');
  }
  return document;
};

describe('пример: документ OpenAPI', () => {
  /** Описание сборки из `main.ts` плюс модуль документации */
  const documented = {
    ...spec,
    plugins: [
      ...spec.plugins,
      openapi({
        info: { title: 'Users API', version: '1.0.0' },
        converters: [zodConverter()],
        pipeline: observability,
        announceHidden: false,
      }),
    ],
  };

  it('описывает каждый публичный endpoint и ни одного скрытого', async () => {
    await using app = await assembleTest({
      ...documented,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    const { paths } = documentOf(app);

    expect(Object.keys(paths).sort()).toEqual([
      '/api/hooks/users',
      '/api/ops/subscriptions',
      '/api/ops/subscriptions/live',
      '/api/ops/subscriptions/{id}',
      '/api/users',
      '/api/users/activity',
      '/api/users/export',
      '/api/users/import',
      '/api/users/search',
      '/api/users/{id}',
      '/api/users/{id}/avatar',
    ]);

    // Оба служебных endpoint'а скрыты с указанием причины: liveness-проба
    // и сам документ
    expect(paths['/health']).toBeUndefined();
    expect(paths['/openapi.json']).toBeUndefined();
  });

  it('берёт имя операции и документацию с операции', async () => {
    await using app = await assembleTest({
      ...documented,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    const { paths } = documentOf(app);

    expect(paths['/api/users'].post).toMatchObject({
      operationId: 'api.users.create',
      summary: 'Создать пользователя',
      tags: ['users'],
    });

    // Bind-карта операции учтена: `dryRun` описан как query-параметр,
    // а не как поле тела
    expect(
      paths['/api/users'].post.parameters?.map(({ name, in: where }) => [
        name,
        where,
      ]),
    ).toEqual([['dryRun', 'query']]);
  });

  it('коды ответов совпадают с тем, что реально отвечает транспорт', async () => {
    await using app = await assembleTest({
      ...documented,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    const { responses } = documentOf(app).paths['/api/users'].post;

    // 201: статус успеха объявлен через `doc.status: 'CREATED'`
    const created = await app.call(CreateUser, {
      name: 'Charlie',
      email: 'charlie@example.com',
    });
    expect(created.status).toBe('CREATED');
    expect(responses['201']).toBeDefined();

    // 409: повтор email возвращает объявленный отказ `EMAIL_TAKEN`
    const conflict = await app.call(CreateUser, {
      name: 'Charlie II',
      email: 'charlie@example.com',
    });
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

/**
 * Реестр подписок (`@nestling/subscriptions`).
 *
 * Тест проходит основной сценарий пакета: подписка открывается, её
 * видно в списке, администратор её завершает, поток закрывается,
 * запись из реестра удаляется.
 */
describe('пример: реестр подписок', () => {
  it('показывает подписку, завершает её и удаляет запись', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    const subscription = streamOf<{ kind: string }>(
      await app.call(ActivityStream),
    );

    // Подписка видна в списке до того, как отдан первый элемент
    const [listed] = unwrap(await app.call(ListSubscriptions));
    expect(listed).toMatchObject({
      transport: 'http',
      pattern: 'GET /api/users/activity',
      kind: 'events',
      itemsOut: 0,
    });
    // `identity` вычисляет функция, заданная в `tracked`: здесь это
    // requestId слоя
    expect(typeof listed.identity).toBe('string');

    // После события подписка отдаёт элемент, и счётчик `itemsOut` растёт
    unwrap(await createUser(app, 'subscriber'));
    const delivered = await subscription.next();
    expect(delivered.value).toMatchObject({ kind: 'created' });
    expect(unwrap(await app.call(ListSubscriptions))[0].itemsOut).toBe(1);

    // Администратор завершает подписку: ответ 204, поток закрывается сам
    const killed = await app.call(KillSubscription, { id: listed.id });
    expect(killed.status).toBe('NO_CONTENT');

    // Итерация завершается сама: хендлер слушает `meta.subscription.signal`
    const tail: unknown[] = [];
    for await (const event of subscription) {
      tail.push(event);
    }
    expect(tail).toEqual([]);

    // Запись удалил `.finally` пайплайна, а не `abort()`
    expect(unwrap(await app.call(ListSubscriptions))).toEqual([]);
  });

  it('возвращает объявленный отказ на неизвестную подписку', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    const refused = await app.call(KillSubscription, { id: 'нет-такой' });

    expect(refused).toMatchObject({
      isSuccess: false,
      status: 'NOT_FOUND',
      value: { code: 'SUBSCRIPTION_NOT_FOUND' },
    });
  });

  it('живой просмотр сам является подпиской и не видит своего opened', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    const feed = streamOf<{ type: string; subscription: { pattern: string } }>(
      await app.call(WatchSubscriptions),
    );

    // Собственная запись просмотра в реестре есть...
    expect(
      unwrap(await app.call(ListSubscriptions)).map(({ pattern }) => pattern),
    ).toEqual(['GET /api/ops/subscriptions/live']);

    // ...а в ленте её нет: `opened` опубликовано до вызова хендлера,
    // то есть до того, как хендлер подписался
    await app.call(ActivityStream);

    const first = await feed.next();
    expect(first.value).toMatchObject({
      type: 'opened',
      subscription: { pattern: 'GET /api/users/activity' },
    });

    await feed.return?.();
  });
});
