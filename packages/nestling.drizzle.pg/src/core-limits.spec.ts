/**
 * Известные границы ядра, в которые пакет упёрся при замере.
 *
 * Тест фиксирует **поведение ядра**, а не поведение пакета: если ядро
 * однажды это починит, тест упадёт — и запись в журнале решений придётся
 * обновить вместе с ним. Правок ядра ради пакета change не делает по
 * построению, поэтому находки живут здесь и в `docs/decisions/ideas.md`.
 *
 * Четвёртая находка замера — про типы, а не про рантайм, и живёт в
 * `plugin.type-test.ts`. Первая — писатель переменной без зависимостей —
 * здесь не фиксируется: ядро закрыло её формой `provide(deps, compute)`
 * в change'е `kernel-boundary-outbox`.
 */

import { FakePool } from './__fixtures__/pool.js';
import { schema } from './__fixtures__/schema.js';
import { PgConnection } from './connection.js';
import type { TxLayerInput } from './plugin.js';
import { drizzlePg } from './plugin.js';

import { describe, expect, it } from '@jest/globals';
import type { Output, Raw } from '@nestlingjs/app';
import { makeEmptyContext } from '@nestlingjs/app';
import { resourceProvider } from '@nestlingjs/container';
import { Ok } from '@nestlingjs/operations';

const db = drizzlePg({ schema });

const raw: Raw = {
  transport: 'test',
  pattern: 'core-limits',
  payload: undefined,
  attributes: {},
};

const endpoint = { transport: 'test', pattern: 'core-limits' };

/**
 * Находка №2: `.ok`-юнит не превращает успех в объявленный отказ.
 *
 * Провалившийся `COMMIT` — ровно этот случай: изменение не сохранено, а
 * ответ уже успешен. Юнит бросает, и ответ становится внутренней ошибкой,
 * хотя честнее был бы отказ с деталями сериализации.
 */
describe('граница ядра: `.ok` не объявляет отказа', () => {
  it('провалившийся коммит доходит до клиента внутренней ошибкой', async () => {
    const pool = new FakePool();
    pool.failing.add('COMMIT');

    const bound = db
      .transaction()
      .bind(
        (ctor) =>
          new (ctor as new (value: PgConnection<typeof schema>) => unknown)(
            new PgConnection(pool.asPool(), schema, 0),
          ),
      );

    const response = await bound.executeWithHandler(
      async (): Output<undefined> => new Ok(undefined),
      makeEmptyContext<TxLayerInput<typeof schema, 'default'>>(raw, endpoint),
    );

    expect(response.isSuccess).toBe(false);
    expect(response.value).toMatchObject({ code: 'internal_error' });
  });
});

/**
 * Находка №3: ресурс не публикует фактов жизненного цикла.
 *
 * Открытие и закрытие пула видны только в логе: операций вроде
 * `outbox.published` у ресурса нет, поэтому подписаться на разрыв
 * соединения нечем.
 */
describe('граница ядра: у ресурса нет операций', () => {
  it('определение ресурса несёт только захват, освобождение и пробу', () => {
    const definition = resourceProvider(db.connection, {
      deps: [],
      acquire: () => new PgConnection(new FakePool().asPool(), schema, 0),
      release: (value: PgConnection<typeof schema>) => value.end(),
      health: async () => 'ok' as const,
    });

    expect(Object.keys(definition).sort()).toEqual([
      'acquire',
      'deps',
      'health',
      'provide',
      'release',
    ]);
  });
});
