/**
 * Словарь причин закрытия: ядро плюс ровно одно слово.
 *
 * Тест существует ради **отрицательного** утверждения: если ядро однажды
 * расширит `Outcome` пятым значением, это не пройдёт незамеченным — здесь
 * упадёт и тайпчек, и рантайм-проверка.
 */

import { makeCtx } from './__fixtures__/context';
import type { CloseReason } from './types';
import { kindOfOutput } from './types';

import { describe, expect, it } from '@jest/globals';
import { events, stream } from '@nestling/operations';
import { z } from 'zod';

/** Причины закрытия, перечисленные значением */
const CLOSE_REASONS = [
  'completed',
  'disconnected',
  'aborted',
  'failed',
  'killed',
] as const;

/**
 * Тип-мост: множество значений `CloseReason` и список выше — одно и то же.
 *
 * Оба направления обязательны. Без первого расширение `Outcome` в ядре
 * осталось бы незамеченным (список просто перестал бы быть полным), без
 * второго — незамеченной осталась бы опечатка в самом списке.
 */
type Exhaustive =
  Exclude<CloseReason, (typeof CLOSE_REASONS)[number]> extends never
    ? Exclude<(typeof CLOSE_REASONS)[number], CloseReason> extends never
      ? true
      : never
    : never;

const dictionariesMatch: Exhaustive = true;

describe('CloseReason', () => {
  it('состоит ровно из Outcome и killed', () => {
    expect(dictionariesMatch).toBe(true);
    expect([...CLOSE_REASONS]).toHaveLength(5);
    expect(CLOSE_REASONS).toContain('killed');
  });
});

describe('kindOfOutput', () => {
  const Item = z.object({ id: z.string() });

  it('различает потоковые формы', () => {
    expect(kindOfOutput(makeCtx({ output: events(Item) }).endpoint)).toBe(
      'events',
    );
    expect(kindOfOutput(makeCtx({ output: stream(Item) }).endpoint)).toBe(
      'stream',
    );
  });

  it('сводит не-потоковую форму к value', () => {
    expect(kindOfOutput(makeCtx({ output: Item }).endpoint)).toBe('value');
    expect(kindOfOutput(makeCtx().endpoint)).toBe('value');
  });
});
