/**
 * Общая обвязка тестов на работающем PostgreSQL.
 *
 * Адрес базы приходит переменной `TEST_DATABASE_URL`. Без неё прогон
 * пропускается: `yarn verify` на машине без базы остаётся зелёным, а CI
 * поднимает PostgreSQL сервисом и адрес задаёт.
 *
 * Имя переменной своё, а не `DATABASE_URL`: прогон тестов не должен
 * зависеть от того, что лежит в окружении разработчика под именем,
 * которое читает боевая секция конфига.
 */

import type { PgSchema } from '../src/index.js';
import { PgConnection } from '../src/index.js';

import { describe } from '@jest/globals';
import pg from 'pg';

/** Адрес базы; без него тесты этого каталога пропускаются */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** `describe`, который молчит без базы */
export const describeWithDatabase: (title: string, suite: () => void) => void =
  TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Соединение на схеме теста.
 *
 * Собирается значением, а не ресурсом: захват ресурса — работа
 * контейнера, а здесь проверяется SQL, который пакет шлёт базе.
 */
export function openTestConnection<S extends PgSchema>(
  schema: S,
): PgConnection<S> {
  return new PgConnection(
    new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 10 }),
    schema,
    0,
  );
}
