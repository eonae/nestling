/**
 * Известные границы ядра, на которые пакет наткнулся при замере.
 *
 * Тест фиксирует **поведение ядра**, а не поведение пакета: если ядро
 * однажды это починит, тест упадёт — и запись в журнале решений придётся
 * обновить вместе с ним. Правок ядра ради пакета change #7 не делает по
 * построению, поэтому находка живёт здесь и в `docs/decisions/ideas.md`.
 *
 * Находка №4: `.finally` не выполняется, если потоковый ответ закрыт
 * **до первого** `next()`. Обёртка завершения — асинхронный генератор, а
 * `return()` на неначатом генераторе его тела не исполняет, поэтому
 * отложенные `.finally`-юниты не отрабатывают. Для реестра это значит:
 * запись подписки, чей ответ транспорт получил и закрыл, не прочитав ни
 * одного элемента, останется в реестре до конца жизни процесса.
 */

import { describe, expect, it } from '@jest/globals';
import { events, Ok } from '@nestling/contracts';
import type { Outcome, Raw } from '@nestling/pipeline';
import { makeEmptyContext, makePipeline } from '@nestling/pipeline';
import { z } from 'zod';

const Row = z.object({ id: z.string() });

const raw: Raw = {
  transport: 'test',
  pattern: 'rows:watch',
  payload: undefined,
  attributes: {},
};

async function* rows(): AsyncIterableIterator<{ id: string }> {
  yield { id: '1' };
  yield { id: '2' };
}

/** Ответ ручки с формой `events` и наблюдателем исхода */
async function respond(
  outcomes: Outcome[],
): Promise<AsyncIterableIterator<unknown>> {
  const pipeline = makePipeline().finally((outcome) => {
    outcomes.push(outcome);
  });

  const ctx = makeEmptyContext(raw, {
    transport: 'test',
    pattern: 'rows:watch',
    output: events(Row),
  });

  const response = await pipeline.executeWithHandler(
    async () => new Ok(rows()),
    ctx,
  );

  return (response as { value: AsyncIterableIterator<unknown> }).value;
}

describe('граница ядра: закрытие непрочитанного потокового ответа', () => {
  it('не выполняет .finally, если поток закрыт до первого next()', async () => {
    const outcomes: Outcome[] = [];
    const iterator = await respond(outcomes);

    await iterator.return?.();

    // Находка №4: наблюдатель исхода не вызван, хотя итератор закрыт
    expect(outcomes).toEqual([]);
  });

  it('выполняет .finally, если прочитан хотя бы один элемент', async () => {
    const outcomes: Outcome[] = [];
    const iterator = await respond(outcomes);

    await iterator.next();
    await iterator.return?.();

    expect(outcomes).toEqual(['completed']);
  });
});
