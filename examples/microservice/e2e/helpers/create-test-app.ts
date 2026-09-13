import { appConfigKeys } from '../../src/app.config.js';
import { api, app } from '../../src/app.js';
import { db } from '../../src/persistence.js';

import { describe } from '@jest/globals';
import type { AssembledApp } from '@nestlingjs/app';
import { makeApp, objectSource } from '@nestlingjs/app';
import type { HttpServer } from '@nestlingjs/transport.http';
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
  app: AssembledApp;
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
 * Порт задаётся ключом `HTTP_PORT=0` из объекта-источника: сокетом владеет
 * сервер, а фактический адрес известен только после `listen`. Секреты и
 * адрес базы привязываются тем же способом, `process.env` не трогается.
 */
export async function createTestApp(): Promise<TestAppContext> {
  if (!TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL не задан');
  }

  pool = new Pool({ connectionString: TEST_DATABASE_URL });
  await reset();

  // Та же декларация, что в `app.ts`, с эфемерным портом и секретами из
  // объекта: состав берётся из `app.spec`, включая оба транспорта на
  // общем сервере
  const assembled = makeApp({
    features: app.spec.features,
    plugins: app.spec.plugins,
    switches: app.spec.switches,
    policies: app.spec.policies,
    transports: app.spec.transports,
    metrics: app.spec.metrics,
    config: [
      [
        objectSource(
          { API_TOKEN: E2E_TOKEN, WEBHOOK_SECRET: E2E_WEBHOOK_SECRET },
          'e2e',
        ),
        appConfigKeys,
      ],
      // Адрес базы — ключ секции соединения, а не секции приложения: её
      // объявляет пакет `@nestlingjs/drizzle.pg`
      [objectSource({ DATABASE_URL: TEST_DATABASE_URL }, 'e2e-db'), db.keys],
      [
        objectSource({ HTTP_PORT: '0', HTTP_HOST: '127.0.0.1' }, 'e2e-http'),
        serverKeys(),
      ],
    ],
  }).assemble();

  await assembled.run();

  const server = assembled.servers.get(api.name) as HttpServer | undefined;
  const address = server?.address();
  if (!address) {
    throw new Error('server did not report an address after listen()');
  }

  return {
    app: assembled,
    baseUrl: `http://127.0.0.1:${address.port}`,
    reset,
  };
}

export async function closeTestApp(context: TestAppContext): Promise<void> {
  await context.app.close();
  await pool?.end();
  pool = undefined;
}
