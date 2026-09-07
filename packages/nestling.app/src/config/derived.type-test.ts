/**
 * Типовые тесты вычисляемого поля секции.
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на проверке пакета. Три правила `derived` держатся типами, а не
 * рантайм-проверками, и негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { secret } from './declaration.js';
import type { Config } from './families.js';
import { makeConfig } from './section.js';

import { z } from 'zod';

const PgConfig = makeConfig(
  'typetestPg',
  {
    host: z.string().default('localhost'),
    port: z.coerce.number().int().default(5432),
    password: secret(z.string()),
  },
  (derived) => ({
    url: derived(
      ['host', 'port', 'password'],
      (host, port, password) =>
        `postgresql://app:${password}@${host}:${port}/app`,
    ),
    doublePort: derived(['port'], (port) => port * 2),
  }),
);

declare const pg: Config<typeof PgConfig>;

/** Тип вычисляемого поля — возврат его функции */
const url: string = pg.url;
const doublePort: number = pg.doublePort;

/** Поля рекорда в проекции остались прежними */
const host: string = pg.host;
const port: number = pg.port;

/** Возврат функции не расширяется до `unknown` */
// @ts-expect-error `url` — строка, не число
const urlAsNumber: number = pg.url;

/** Опечатка в имени зависимости не компилируется */
const misspelled = makeConfig(
  'typetestMisspelled',
  { host: z.string() },
  // @ts-expect-error поля `hosst` в рекорде нет
  (derived) => ({ upper: derived(['hosst'], (host) => host) }),
);

/** Ложная аннотация аргумента не компилируется */
const wrongArgument = makeConfig(
  'typetestWrongArgument',
  { port: z.coerce.number() },
  (derived) => ({
    // @ts-expect-error `port` — число, аннотация строкой не проходит
    label: derived(['port'], (port: string) => port),
  }),
);

/** Цепочка вычисляемых полей невозможна: их имён в рекорде нет */
const chained = makeConfig(
  'typetestChained',
  { host: z.string() },
  (derived) => ({
    upper: derived(['host'], (host) => host.toUpperCase()),
    // @ts-expect-error зависеть от другого вычисляемого поля нельзя
    twice: derived(['upper'], (upper) => upper),
  }),
);

/** Reloadable-секция принимает тот же третий аргумент */
const RuntimeConfig = makeConfig.reloadable(
  'typetestRuntime',
  { rps: z.coerce.number().default(100) },
  (derived) => ({ perMinute: derived(['rps'], (rps) => rps * 60) }),
);

declare const runtime: Config<typeof RuntimeConfig>;

const perMinute: number = runtime.perMinute;

runtime.onChange(new AbortController().signal, (next) => {
  const nextPerMinute: number = next.perMinute;
});

/** Секция-семейство принимает его же */
const HttpConfig = makeConfig.family(
  'typetestHttp',
  {
    host: z.string().default('0.0.0.0'),
    port: z.coerce.number().int().default(3000),
  },
  (derived) => ({
    address: derived(['host', 'port'], (host, port) => `${host}:${port}`),
  }),
);

declare const http: Config<ReturnType<typeof HttpConfig>>;

const address: string = http.address;

/** Секция без третьего аргумента остаётся прежней */
const PlainConfig = makeConfig('typetestPlain', { size: z.coerce.number() });

declare const plain: Config<typeof PlainConfig>;

const size: number = plain.size;

// @ts-expect-error вычисляемых полей у секции без третьего аргумента нет
const missing = plain.anything;

export {
  address,
  chained,
  doublePort,
  host,
  misspelled,
  missing,
  perMinute,
  plain,
  port,
  size,
  url,
  urlAsNumber,
  wrongArgument,
};
