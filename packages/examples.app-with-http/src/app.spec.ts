/**
 * App-тесты примера: запрос через полный пайплайн, но без сокета.
 *
 * Уровень между юнитом и e2e: слои, валидация схем и страж границы
 * отрабатывают целиком, транспорт в эфир не выходит, `process.env` не
 * трогается. Мокается один архитектурный шов — порт репозитория.
 */

import { ILogger, observability } from './modules/logger';
import {
  KillSubscription,
  ListSubscriptions,
  WatchSubscriptions,
} from './modules/ops/subscriptions.endpoint';
import { ClaimQuotaImpl } from './modules/quotas/quotas.module';
import { ActivityHub } from './modules/users/activity.hub';
import {
  ActivityStream,
  CreateUser,
  DeleteUser,
  GetUser,
  ListUsers,
} from './modules/users/endpoints';
import { ClaimQuota, QuotaExceeded } from './contracts';
import { OpsFeature, QuotasFeature, UsersFeature } from './features';
import { appLogging } from './infrastructure';
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

/** Сборка примера без транспортного go-live — тот же словарь, что в `main.ts` */
const spec = {
  features: [UsersFeature, OpsFeature, QuotasFeature],
  transports: [http({ port: 0 })],
  // Те же инварианты, что в бою: тестовый корень их не ослабляет
  policies: [
    everyEndpoint({ transport: HttpTransport$ }).hasLayer(
      observability,
      'observability',
    ),
    everyEndpoint({ transport: HttpTransport$ }).hasVar(RequestId, 'requestId'),
  ],
};

describe('пример: app-тесты через assembleTest', () => {
  it('исполняет ручку через полный пайплайн', async () => {
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

    // Admin защищён доменным правилом, а не транспортом
    expect(await app.call(DeleteUser, { id: '1' })).toMatchObject({
      isSuccess: false,
      status: 'FORBIDDEN',
      value: { code: 'USER_NOT_DELETABLE' },
    });
  });

  it('показывает выпавший прунингом узел', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    // Единственный потребитель хранилища — боевой репозиторий; заменили
    // его — соединение не открывается, и узла в графе нет
    expect(app.pruned).toContain('UsersStore');
    expect(app.get(HttpTransport$)).not.toBeNull();
  });

  it('без overrides граф остаётся боевым', async () => {
    await using app = await assembleTest(spec);

    expect(app.pruned).toEqual([]);
    expect(unwrap(await app.call(ListUsers))).toHaveLength(2);
  });
});

/** Тихий сток для уровней, которые тесту не интересны */
const drop = (): void => undefined;

/** Логгер-шпион: репозиторий пишет корреляцию через него */
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

describe('пример: ambient-контекст в глубине графа', () => {
  it('репозиторий видит requestId, положенный слоем наблюдаемости', async () => {
    const spy = spyLogger();

    // Репозиторий боевой: подменён только логгер, чтобы прочитать то, что
    // он написал. Значение `requestId` в графе никто не подставляет — оно
    // приезжает по-настоящему, слоем `observability`
    await using app = await assembleTest({
      ...spec,
      overrides: [[ILogger, spy.logger]],
    });

    unwrap(await app.call(GetUser, { id: '1' }));

    // Ручка вызвана без единого упоминания requestId, а глубокий сервис,
    // не получивший его параметром, всё равно им подписался
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

    // Подменён ридер, а не контекст: пайплайн по-прежнему кладёт свой
    // requestId, но сервис читает то, что объявил тест
    expect(spy.lines).toContain('[req-fixed] byId 1');
  });
});

describe('пример: инфраструктура едет вместе с фичей', () => {
  it('фича привозит ровно ту инфраструктуру, которую импортирует', async () => {
    // `ops` импортирует логирование и реестр подписок: её админские ручки
    // живут под теми же политиками, что и прикладные. Прикладных
    // провайдеров фичи `users` при этом в графе нет — их никто не выбрал
    await using app = await assembleTest({ ...spec, select: 'ops' });

    expect(app.get(ILogger)).not.toBeNull();
    expect(app.get(SubscriptionRegistry)).not.toBeNull();
    expect(app.get(ActivityHub)).toBeNull();
    expect(app.get(HttpTransport$)).not.toBeNull();
  });

  it('выбранная фича привозит свою инфраструктуру', async () => {
    await using app = await assembleTest({ ...spec, select: 'users' });

    expect(app.get(ILogger)).not.toBeNull();
    expect(app.get(ActivityHub)).not.toBeNull();
  });

  it('co-located фичи, импортирующие одно значение, делят инстанс', async () => {
    // Обе фичи импортируют **одно значение** `appLogging`: модуль
    // регистрируется один раз, и логгер у них общий. Вызови любая из них
    // `logging({ … })` заново — сборка упала бы на коллизии имён
    await using app = await assembleTest(spec);

    const logger = app.get(ILogger);

    expect(logger).not.toBeNull();
    expect(app.get(ILogger)).toBe(logger);
  });
});

/** Создаёт пользователя через полный пайплайн ручки */
const createUser = (
  app: Awaited<ReturnType<typeof assembleTest>>,
  suffix: string,
) =>
  app.call(CreateUser, {
    name: `User ${suffix}`,
    email: `user-${suffix}@example.com`,
  });

describe('пример: фичи общаются контрактами', () => {
  it.each<['local-first' | 'always-remote']>([
    ['local-first'],
    ['always-remote'],
  ])('политика %s меняет путь вызова, но не call-site', async (dispatch) => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
      // Политика — конфиг: в тесте она задаётся `vars()`, в бою —
      // переменной окружения или привязанным источником
      config: vars({ NESTLING_PORTS_DISPATCH: dispatch }),
    });

    expect(unwrap(await createUser(app, dispatch))).toMatchObject({
      name: `User ${dispatch}`,
    });
  });

  it('исчерпанная квота приезжает настоящим отказом соседней фичи', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    // Лимит фичи квот — пять мест
    for (const index of [1, 2, 3, 4, 5]) {
      unwrap(await createUser(app, String(index)));
    }

    const refused = await createUser(app, 'sixth');

    // Код доехал до границы вызывающей ручки и остался в её контракте:
    // `errors:` объявляет отказ соседней фичи наравне со своими
    expect(refused).toMatchObject({
      isSuccess: false,
      status: 'TOO_MANY_REQUESTS',
      value: { code: QuotaExceeded.code, details: { limit: 5 } },
    });
  });

  it('реализация контракта вызывается в тесте по значению — как ручка', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    // Никакой отдельной машинерии: та же `app.call` по идентичности
    // декларации, что и для HTTP-ручки
    expect(unwrap(await app.call(ClaimQuotaImpl, { email: 'a@b.c' }))).toEqual({
      remaining: 4,
    });
  });
});

describe('пример: эксплуатационный профиль вызова', () => {
  it('исчерпанный бюджет отказывает, не тронув соседнюю фичу', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    // Вызыватель — обычный узел графа, поэтому в тесте он достаётся тем же
    // `app.get`, что транспорт или логгер
    const quotas = app.get(ClaimQuota.port);

    const refused = await quotas?.call(
      { email: 'late@example.com' },
      // Момент в прошлом: бюджет исчерпан ещё до вызова
      { deadline: new Date(Date.now() - 1) },
    );

    // Kernel-код, а не `UNKNOWN`: множество ответов порта закрыто и им тоже
    expect(refused).toMatchObject({
      status: 'TIMEOUT',
      code: 'DEADLINE_EXCEEDED',
    });

    // Реализация не исполнялась — место в квоте не занято: следующий вызов
    // видит нетронутый лимит
    expect(unwrap(await app.call(ClaimQuotaImpl, { email: 'a@b.c' }))).toEqual({
      remaining: 4,
    });
  });

  it('ключ идемпотентности команды доезжает до сервиса в глубине', async () => {
    const spy = spyLogger();

    await using app = await assembleTest({
      ...spec,
      overrides: [
        [UsersRepository, inMemoryUsersRepo()],
        [ILogger, spy.logger],
      ],
    });

    unwrap(await createUser(app, 'signed'));

    // `emit` резолвится по факту доставки, а не обработки
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Ключом взят id пользователя — журнал подписан идентичностью
    // намерения, которую задал вызывающий, а не отчеканил вызыватель
    expect(spy.lines).toContainEqual(
      expect.stringMatching(/^signup (\d+) recorded, intent \1$/),
    );
  });
});

describe('пример: матрица select-топологий', () => {
  it('собирает каждый вариант деплоя без сокетов', async () => {
    const reports = await checkTopologies(spec, ['all', 'users', 'ops']);

    expect(reports.map(({ select }) => select)).toEqual([
      'all',
      'users',
      'ops',
    ]);

    // `users` тянет `ops` и `quotas` через `dependsOn`; сам `ops` объявляет
    // эксплуатационные ручки — liveness-пробу и админ-плоскость подписок,
    // включая двух подписчиков фактов на шине
    expect(reports[1].report.features).toEqual(['users', 'ops', 'quotas']);
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

  it('прогоняет инварианты и отдаёт состав detached-ручек значением', async () => {
    const [{ report }] = await checkTopologies(spec, ['all']);

    // Матрица гоняет `policies` в каждой топологии — сюда мы доходим
    // только потому, что инвариант соблюдён во всех. Состав opt-out'ов
    // сравнивается значением из отчёта, а не парсингом stdout.
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
 * Документ выводится из тех же деклараций, которые обслуживают запросы, —
 * и это проверяется буквально: коды ответов сверяются с ответами, которые
 * даёт транспорт на живых вызовах.
 */
/** Документ из собранного графа: он построен на ASSEMBLE и лежит значением */
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
  /** Тот же корень, что в `main.ts`, плюс модуль документации */
  const documented = {
    ...spec,
    modules: [
      appLogging,
      openapi({
        info: { title: 'Users API', version: '1.0.0' },
        converters: [zodConverter()],
        pipeline: observability,
        announceHidden: false,
      }),
    ],
  };

  it('описывает все публичные ручки и ни одной скрытой', async () => {
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

    // Обе служебные ручки скрыты причиной: liveness-проба и сам документ
    expect(paths['/health']).toBeUndefined();
    expect(paths['/openapi.json']).toBeUndefined();
  });

  it('берёт имя операции и документацию с контракта', async () => {
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

    // Пометка `query()` контракта разложена: `dryRun` — параметр, а не поле
    // тела
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

    // 201: успешный статус объявлен `doc.status: 'CREATED'`
    const created = await app.call(CreateUser, {
      name: 'Charlie',
      email: 'charlie@example.com',
    });
    expect(created.status).toBe('CREATED');
    expect(responses['201']).toBeDefined();

    // 409: тот же email второй раз — объявленный отказ `EMAIL_TAKEN`
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

/** Поток из ответа границы: у `events`-ручки значение — итератор */
const streamOf = <T>(response: unknown): AsyncIterableIterator<T> =>
  (response as { value: AsyncIterableIterator<T> }).value;

/**
 * Реестр подписок — satellite-пакет в работе.
 *
 * Тест драйвит ровно тот сценарий, ради которого пакет и существует:
 * подписка открылась, её видно списком, администратор её завершил, поток
 * закрылся, запись снялась. Ни одной строки ядра при этом не задействовано
 * иначе, чем через публичные примитивы.
 */
describe('пример: реестр подписок', () => {
  it('показывает подписку, убивает её и снимает запись', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository, inMemoryUsersRepo()]],
    });

    const subscription = streamOf<{ kind: string }>(
      await app.call(ActivityStream),
    );

    // Подписка видна администратору до того, как ушёл первый элемент
    const [listed] = unwrap(await app.call(ListSubscriptions));
    expect(listed).toMatchObject({
      transport: 'http',
      pattern: 'GET /api/users/activity',
      kind: 'events',
      itemsOut: 0,
    });
    // `identity` считает экстрактор композиции — здесь это requestId слоя
    expect(typeof listed.identity).toBe('string');

    // Событие в ленте: подписка отдаёт элемент, счётчик догоняет
    unwrap(await createUser(app, 'subscriber'));
    const delivered = await subscription.next();
    expect(delivered.value).toMatchObject({ kind: 'created' });
    expect(unwrap(await app.call(ListSubscriptions))[0].itemsOut).toBe(1);

    // Административное завершение: ответ 204, поток закрывается сам
    const killed = await app.call(KillSubscription, { id: listed.id });
    expect(killed.status).toBe('NO_CONTENT');

    // Итерация завершается сама: хендлер слушает `meta.subscription.signal`
    const tail: unknown[] = [];
    for await (const event of subscription) {
      tail.push(event);
    }
    expect(tail).toEqual([]);

    // Запись снял `.finally` пайплайна, а не `abort()`
    expect(unwrap(await app.call(ListSubscriptions))).toEqual([]);
  });

  it('отказывает объявленным отказом на неизвестную подписку', async () => {
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

    // Собственная запись в реестре есть...
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
