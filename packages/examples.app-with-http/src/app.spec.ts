/**
 * App-тесты примера: запрос через полный пайплайн, но без сокета.
 *
 * Уровень между юнитом и e2e: слои, валидация схем и страж границы
 * отрабатывают целиком, транспорт в эфир не выходит, `process.env` не
 * трогается. Мокается один архитектурный шов — порт репозитория.
 */

import {
  CreateUser,
  DeleteUser,
  GetUser,
  ListUsers,
} from './modules/users/endpoints';
import { LoggingFeature, UsersFeature } from './features';
import { inMemoryUsersRepo, UsersRepository } from './testing';

import { describe, expect, it } from '@jest/globals';
import { assembleTest, checkTopologies, unwrap, vars } from '@nestling/testing';
import { http, HttpTransport$ } from '@nestling/transport.http';

/** Сборка примера без транспортного go-live — тот же словарь, что в `main.ts` */
const spec = {
  features: [UsersFeature, LoggingFeature],
  transports: [http({ port: 0 })],
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

describe('пример: матрица select-топологий', () => {
  it('собирает каждый вариант деплоя без сокетов', async () => {
    const reports = await checkTopologies(spec, ['all', 'users', 'logging']);

    expect(reports.map(({ select }) => select)).toEqual([
      'all',
      'users',
      'logging',
    ]);

    // `users` тянет `logging` через `dependsOn`, а сам `logging` ручек не
    // объявляет — это и проверяет матрица
    expect(reports[1].report.features).toEqual(['users', 'logging']);
    expect(reports[2].report.endpoints).toEqual([]);
    expect(reports[0].report.endpoints.length).toBeGreaterThan(0);
  });
});
