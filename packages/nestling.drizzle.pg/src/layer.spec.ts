/**
 * Слой транзакции на подстановке пула.
 *
 * Проверяется порядок команд вокруг хендлера и возврат клиента в пул на
 * каждом исходе. Приложение целиком здесь не собирается: слой — обычный
 * пайплайн, и `bind` создаёт инстанс моста без контейнера.
 */

import { FakePool } from './__fixtures__/pool.js';
import { schema } from './__fixtures__/schema.js';
import { PgConnection } from './connection.js';
import type { TxLayerInput } from './plugin.js';
import { drizzlePg } from './plugin.js';

import { describe, expect, it } from '@jest/globals';
import type { Output, Raw, ResponseContext } from '@nestlingjs/app';
import { makeEmptyContext } from '@nestlingjs/app';
import { Ok } from '@nestlingjs/operations';
import { sql } from 'drizzle-orm';

const db = drizzlePg({ schema });

/** Накопленный контекст слоя: сессия и значение переменной */
type LayerInput = TxLayerInput<typeof schema, 'default'>;

const raw: Raw = {
  transport: 'test',
  pattern: 'layer',
  payload: undefined,
  attributes: {},
};

const endpoint = { transport: 'test', pattern: 'layer' };

/** Команда, по которой в журнале виден запрос хендлера */
const HANDLER_QUERY = 'select 1';

/** Хендлер, который пишет транзакцией запроса */
const writing = async (
  _payload: unknown,
  meta: LayerInput & { signal: AbortSignal },
): Output<undefined> => {
  await meta.tx.execute(sql`select 1`);

  return new Ok(undefined);
};

/** Прогоняет слой с подстановкой пула */
async function run(
  pool: FakePool,
  handler: (
    payload: unknown,
    meta: LayerInput & { signal: AbortSignal },
  ) => Output<undefined>,
  options: { isolation?: 'serializable'; signal?: AbortSignal } = {},
): Promise<ResponseContext<undefined>> {
  const connection = new PgConnection(pool.asPool(), schema, 0);

  const layer =
    options.isolation === undefined
      ? db.transaction()
      : db.transaction({ isolation: options.isolation });

  const bound = layer.bind(
    (ctor) =>
      new (ctor as new (value: PgConnection<typeof schema>) => unknown)(
        connection,
      ),
  );

  return bound.executeWithHandler(
    handler,
    makeEmptyContext<LayerInput>(raw, endpoint, options.signal),
  );
}

describe('db.transaction(): успешный запрос', () => {
  it('шлёт `BEGIN` до хендлера и `COMMIT` после него', async () => {
    const pool = new FakePool();

    const response = await run(pool, writing);

    expect(response.isSuccess).toBe(true);
    expect(pool.commands).toEqual(['BEGIN', HANDLER_QUERY, 'COMMIT']);
  });

  it('возвращает клиента в пул', async () => {
    const pool = new FakePool();

    await run(pool, writing);

    expect(pool.leased).toBe(0);
  });

  it('доводит уровень изоляции до команды открытия', async () => {
    const pool = new FakePool();

    await run(pool, writing, { isolation: 'serializable' });

    expect(pool.commands[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
  });
});

describe('db.transaction(): отказ', () => {
  it('откатывает транзакцию и возвращает клиента', async () => {
    const pool = new FakePool();

    const response = await run(pool, async (_payload, meta) => {
      await meta.tx.execute(sql`select 1`);

      throw new Error('хендлер упал');
    });

    expect(response.isSuccess).toBe(false);
    expect(pool.commands).toEqual(['BEGIN', HANDLER_QUERY, 'ROLLBACK']);
    expect(pool.leased).toBe(0);
  });

  it('провалившийся `COMMIT` меняет ответ на ошибку', async () => {
    const pool = new FakePool();
    pool.failing.add('COMMIT');

    const response = await run(pool, writing);

    expect(response.isSuccess).toBe(false);
    expect(pool.leased).toBe(0);
  });

  it('отмена запроса не оставляет соединения занятым', async () => {
    const pool = new FakePool();
    const controller = new AbortController();

    await run(
      pool,
      async () => {
        controller.abort(new Error('клиент отключился'));

        throw new Error('клиент отключился');
      },
      { signal: controller.signal },
    );

    expect(pool.commands).toContain('ROLLBACK');
    expect(pool.leased).toBe(0);
  });
});
