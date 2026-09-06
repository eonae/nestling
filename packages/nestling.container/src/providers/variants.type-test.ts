/**
 * Типовые тесты хелперов провайдеров.
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function */

import { makeToken } from '../common.js';

import { factoryProvider, resourceProvider } from './variants.js';

interface IConnection {
  query(sql: string): string;
}

const Connection = makeToken<IConnection>('TypeTestConnection');
const Dsn = makeToken<string>('TypeTestDsn');

const connect = (dsn: string): IConnection => ({ query: () => dsn });

/** Синхронная фабрика — обычный случай */
const sync = factoryProvider(Connection, (dsn) => connect(dsn), [Dsn] as const);

/** Фабрика, объявленная `async`, не компилируется: фаза сборки без I/O */
const asyncFactory = factoryProvider(
  Connection,
  // @ts-expect-error фабрика провайдера синхронна
  async (dsn) => connect(dsn),
  [Dsn] as const,
);

/** `Promise` в возвращаемом значении не компилируется и без `async` */
const promiseFactory = factoryProvider(
  Connection,
  // @ts-expect-error фабрика провайдера синхронна
  (dsn) => Promise.resolve(connect(dsn)),
  [Dsn] as const,
);

/** Ресурс: `acquire` получает зависимости и сигнал последним */
const pool = resourceProvider(Connection, {
  deps: [Dsn] as const,
  acquire: (dsn, signal) => (signal.aborted ? connect('') : connect(dsn)),
  release: (connection) => void connection.query('close'),
});

/** Сигнал в списке зависимостей не объявляется: он приходит сам */
const wrongDeps = resourceProvider(Connection, {
  deps: [Dsn, Dsn] as const,
  // @ts-expect-error токенов два, поэтому `acquire` принимает три аргумента
  acquire: (dsn: string, signal: AbortSignal) => connect(dsn),
  release: () => {},
});
