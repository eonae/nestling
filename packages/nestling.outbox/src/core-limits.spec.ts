/**
 * Известные границы ядра, в которые пакет упёрся при замере.
 *
 * Тест фиксирует **поведение ядра**, а не поведение пакета: если ядро
 * однажды это починит, тест упадёт — и запись в журнале решений придётся
 * обновить вместе с ним. Правок ядра ради пакета change не делает по
 * построению, поэтому находки живут здесь и в `docs/decisions/ideas.md`.
 */

import { databasePlugin, OutboxStore$, PingUser } from './__fixtures__/app.js';
import { Tx } from './__fixtures__/transaction.js';
import { testTransport } from './__fixtures__/transport.js';
import { outbox } from './plugin.js';

import { describe, expect, it } from '@jest/globals';
import type { Raw } from '@nestling/app';
import {
  makeApp,
  makeEmptyContext,
  makeFeature,
  makePipeline,
} from '@nestling/app';
import { Ok } from '@nestling/operations';
import { assembleTest } from '@nestling/testing';

const raw: Raw = {
  transport: 'test',
  pattern: 'core-limits',
  payload: undefined,
  attributes: {},
};

/**
 * Находка №1: `Var.provide(compute)` получает только контекст.
 *
 * Зависимостей из контейнера у писателя переменной нет, а соединение с
 * базой приходит именно оттуда. Поэтому слой транзакции обязан состоять
 * из двух юнитов: первый — класс с `@Handler`, который кладёт соединение
 * в контекст, второй — сам писатель. Цена — один юнит-мост.
 */
describe('граница ядра: писатель переменной не видит контейнера', () => {
  it('без юнита-моста соединения в контексте нет', async () => {
    const pipeline = makePipeline().pre(
      Tx.provide<{ db?: { begin(): unknown } }>((ctx) => {
        // Единственный канал — накопленный `input`; контейнера здесь нет
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return ctx.input.db!.begin() as never;
      }),
    );

    const response = await pipeline.executeWithHandler(
      async () => new Ok(undefined),
      makeEmptyContext(raw, { transport: 'test', pattern: 'core-limits' }),
    );

    expect(response.isSuccess).toBe(false);
  });
});

/**
 * Находка №2: у события нет типизированного ключа идемпотентности.
 *
 * `PublishOptions.idempotencyKey` есть у шины независимо от вида
 * операции, но `MetaOf<C>` даёт поле только команде. На приёме ключ
 * доезжает транспортным атрибутом, и подписчику события приходится
 * доставать его писателем `withIdempotencyKey()`.
 */
describe('граница ядра: ключ идемпотентности события', () => {
  it('в атрибуты кадра он попадает, а в meta подписчика — нет', () => {
    const context = makeEmptyContext(
      { ...raw, attributes: { idempotencyKey: 'rec-1' } },
      { transport: 'bus', pattern: 'outbox.spec.event' },
    );

    // Значение приехало кадром — но само по себе в накопленный вход не
    // попадает: положить его туда должен юнит пайплайна
    expect(context.raw.attributes.idempotencyKey).toBe('rec-1');
    expect(context.input).toEqual({});
  });
});

/**
 * Находка №3: текст ошибки о недостающей зависимости задаёт контейнер.
 *
 * Пакет не может ни перехватить его, ни дополнить: `assemble` зовёт
 * `build()` без обёртки. Единственное, что пакет в этом тексте выбирает,
 * — имя потребителя, поэтому починки записаны в идентификатор DI-токена.
 */
describe('граница ядра: чужой текст ошибки сборки', () => {
  it('приложение без шины падает форматом контейнера с починками пакета', async () => {
    const busless = makeApp({
      features: [makeFeature({ name: 'users', endpoints: [PingUser] })],
      plugins: [
        databasePlugin,
        outbox({ transaction: Tx, store: OutboxStore$, operations: [] }),
      ],
      transports: [testTransport()],
    });

    let failure: Error | undefined;

    try {
      await assembleTest(busless);
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).toContain('Unsatisfied dependencies');
    expect(failure?.message).toContain("add a bus transport to 'transports:'");
    expect(failure?.message).toContain('remove the outbox plugin');
  });
});
