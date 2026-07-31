/**
 * App-тесты примера: запрос через полный пайплайн, но без сокета.
 *
 * Уровень между юнитом и e2e: слои, валидация схем и страж границы
 * отрабатывают целиком, транспорт в эфир не выходит, `process.env` не
 * трогается. Мокается один архитектурный шов — порт репозитория.
 */

import { ILogger, observability } from './modules/logger';
import {
  CreateUser,
  DeleteUser,
  GetUser,
  ListUsers,
} from './modules/users/endpoints';
import { OpsFeature, UsersFeature } from './features';
import { inMemoryUsersRepo, UsersRepository } from './testing';

import { describe, expect, it } from '@jest/globals';
import { everyEndpoint, RequestId } from '@nestling/pipeline';
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
  features: [UsersFeature, OpsFeature],
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
  it('без выбранной фичи провайдеров инфра-модуля нет в графе', async () => {
    // `ops` — единственная ручка вне инвариантов (detached), слой
    // наблюдаемости ей не нужен, логгер не импортирует никто из выбранного
    await using app = await assembleTest({ ...spec, select: 'ops' });

    expect(app.get(ILogger)).toBeNull();
    expect(app.get(HttpTransport$)).not.toBeNull();
  });

  it('выбранная фича привозит свою инфраструктуру', async () => {
    await using app = await assembleTest({ ...spec, select: 'users' });

    expect(app.get(ILogger)).not.toBeNull();
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

describe('пример: матрица select-топологий', () => {
  it('собирает каждый вариант деплоя без сокетов', async () => {
    const reports = await checkTopologies(spec, ['all', 'users', 'ops']);

    expect(reports.map(({ select }) => select)).toEqual([
      'all',
      'users',
      'ops',
    ]);

    // `users` тянет `ops` через `dependsOn`; сам `ops` объявляет
    // только эксплуатационную ручку — это и проверяет матрица
    expect(reports[1].report.features).toEqual(['users', 'ops']);
    expect(reports[2].report.endpoints.map(({ pattern }) => pattern)).toEqual([
      'GET /health',
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
