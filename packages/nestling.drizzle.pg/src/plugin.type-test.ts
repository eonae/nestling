/**
 * Проверки типов соединения.
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc`. Негативные случаи закрыты `@ts-expect-error`: исчезни ошибка
 * компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  analyticsSchema,
  reports,
  schema,
  users,
} from './__fixtures__/schema.js';
import type { PgSession, PgTx } from './connection.js';
import type { SessionKey, TxKey } from './naming.js';
import { drizzlePg } from './plugin.js';

import type { CtxReader, EmptyInput, PreUnitFn } from '@nestlingjs/app';
import { makePipeline } from '@nestlingjs/app';

const db = drizzlePg({ schema });
const analytics = drizzlePg({ name: 'analytics', schema: analyticsSchema });

/** Ключ переменной выводится из имени экземпляра */
const txKey: 'tx' = db.tx.key;
const analyticsTxKey: 'analyticsTx' = analytics.tx.key;

/** Тип схемы доходит до значения переменной */
declare const tx: CtxReader<PgTx<typeof schema>>;

/** Своя таблица: и запись, и реляционный запрос по схеме */
const own = tx.get().insert(users).values({ id: 'u-1', email: 'a@b.c' });
const listed = tx.get().query.users.findMany();

/** Таблицы, которой в схеме этого соединения нет, у запроса нет */
// @ts-expect-error таблица объявлена не в схеме этого соединения
const alien = tx.get().query.reports.findMany();

/** Тип схемы доходит до значения DI-токена соединения */
declare const connection: {
  db: PgTx<typeof schema>;
  begin(): Promise<PgSession<typeof schema>>;
};

/** Значение второго соединения несёт свою схему */
declare const analyticsTx: CtxReader<PgTx<typeof analyticsSchema>>;

const report = analyticsTx.get().query.reports.findMany();

// @ts-expect-error таблица первого соединения во втором не объявлена
const crossed = analyticsTx.get().query.users.findMany();

/**
 * Замер границы, находка №4: `.pre` не принимает юнит, ключ добавки
 * которого — параметр типа.
 *
 * Проверка юнита сводит добавку через `Awaited` и `Exclude`, а шаблонный
 * ключ от параметра типа не сводится, и верный юнит не проходит по типу.
 * Поэтому слой собирается на литеральных ключах, а имя экземпляра
 * подставляет объявленный тип слоя.
 */
function deferredKeyUnit<N extends string>(
  unit: PreUnitFn<EmptyInput, Record<SessionKey<N>, PgSession<typeof schema>>>,
): void {
  // @ts-expect-error ключ добавки — параметр типа, и `.pre` его не сводит
  makePipeline().pre(unit);
}

/** Тот же юнит с литеральным ключом проходит */
function literalKeyUnit(
  unit: PreUnitFn<
    EmptyInput,
    Record<SessionKey<'default'>, PgSession<typeof schema>>
  >,
): void {
  makePipeline().pre(unit);
}

/** Ключ переменной — литерал и в типе, и в значении */
declare const declaredTxKey: TxKey<'analytics'>;
const sameKey: 'analyticsTx' = declaredTxKey;
