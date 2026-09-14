import { appConfigKeys } from '../../src/app.config.js';
import { app } from '../../src/app.js';
import { db } from '../../src/persistence.js';

import { describe } from '@jest/globals';
import { bind } from '@nestlingjs/app';
import type { TestApp } from '@nestlingjs/testing';
import { buildTest, vars } from '@nestlingjs/testing';
import { serverKeys } from '@nestlingjs/transport.http';
import { Pool } from 'pg';

/** Bearer-токен, который e2e-тесты передают в заголовке `authorization` */
export const E2E_TOKEN = 'e2e-token';

/** Секрет, которым e2e-тесты подписывают webhook */
export const E2E_WEBHOOK_SECRET = 'e2e-hook';

/**
 * Адрес базы для прогона.
 *
 * Имя переменной своё, а не `DATABASE_URL`: прогон не должен зависеть от
 * того, что лежит в окружении под именем боевого ключа. Без адреса набор
 * пропускается — база поднимается `yarn db:up` и мигрируется
 * `yarn db:migrate`.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** `describe`, который молчит без базы */
export const describeWithDatabase: (title: string, suite: () => void) => void =
  TEST_DATABASE_URL ? describe : describe.skip;

/** Засев: этих двух пользователей видит каждый файл набора */
export const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };
export const bob = { id: '2', name: 'Bob', email: 'bob@example.com' };

export interface TestAppContext {
  testApp: TestApp;
  baseUrl: string;
  /** Возвращает базу к засеву */
  reset(): Promise<void>;
}

/**
 * Пул засева.
 *
 * Свой, а не пул приложения: e2e работает с сервисом снаружи, и ход
 * внутрь его графа ему не положен.
 */
let pool: Pool | undefined;

async function reset(): Promise<void> {
  if (!pool) {
    throw new Error('пул засева не открыт');
  }

  await pool.query('delete from "users"');
  await pool.query(
    'insert into "users" ("id", "name", "email") values ($1, $2, $3), ($4, $5, $6)',
    [alice.id, alice.name, alice.email, bob.id, bob.name, bob.email],
  );
}

/**
 * Поднимает приложение на эфемерном порту и засевает базу.
 *
 * Порт задаётся ключом `HTTP_PORT=0` объектным источником: сокетом владеет
 * сервер, а фактический адрес известен только после `run()`. Секреты и
 * адрес базы привязываются тем же способом, `process.env` не трогается.
 */
export async function createTestApp(): Promise<TestAppContext> {
  if (!TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL не задан');
  }

  pool = new Pool({ connectionString: TEST_DATABASE_URL });
  await reset();

  const testApp = await buildTest(app, {
    config: [
      bind(vars({ API_TOKEN: E2E_TOKEN, WEBHOOK_SECRET: E2E_WEBHOOK_SECRET }), {
        keys: appConfigKeys,
      }),
      bind(vars({ DATABASE_URL: TEST_DATABASE_URL }), { keys: db.keys }),
      bind(vars({ HTTP_PORT: '0', HTTP_HOST: '127.0.0.1' }), {
        keys: serverKeys(),
      }),
    ],
  });

  await testApp.run();

  return {
    testApp,
    baseUrl: testApp.baseUrl(),
    reset,
  };
}

export async function closeTestApp(context: TestAppContext): Promise<void> {
  await context.testApp.close();
  await pool?.end();
  pool = undefined;
}
