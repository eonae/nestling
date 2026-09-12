/**
 * Отображение исхода пайплайна на результат вызова инструмента.
 *
 * Отказ доходит до агента результатом с `isError: true`, а не ошибкой
 * протокола: объявленный отказ — часть контракта операции.
 */

import { toCallToolResult } from './result.js';

import { describe, expect, it } from '@jest/globals';
import type { ResponseContext } from '@nestlingjs/app';

/** Успешный исход пайплайна */
const ok = (value: unknown): ResponseContext => ({
  isSuccess: true,
  status: 'ok',
  value,
});

describe('toCallToolResult(response, structured)', () => {
  it('отдаёт успех текстом JSON и структурой', () => {
    const result = toCallToolResult(ok({ id: 'u-1' }), true);

    expect(result).toEqual({
      content: [{ type: 'text', text: '{"id":"u-1"}' }],
      structuredContent: { id: 'u-1' },
    });
    expect(result.isError).toBeUndefined();
  });

  it('не отдаёт структуру, когда схема выхода не объявлена', () => {
    expect(toCallToolResult(ok(42), false)).toEqual({
      content: [{ type: 'text', text: '42' }],
    });
  });

  it('не отдаёт структуру, когда значение не объект', () => {
    expect(toCallToolResult(ok([1, 2]), true)).toEqual({
      content: [{ type: 'text', text: '[1,2]' }],
    });
  });

  it('отдаёт отказ результатом с isError и деталями', () => {
    const result = toCallToolResult(
      {
        isSuccess: false,
        status: 'conflict',
        value: {
          error: 'Email a@b.c is already taken',
          code: 'conflict:email_taken',
          details: { email: 'a@b.c' },
        },
      },
      true,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      code: 'conflict:email_taken',
      message: 'Email a@b.c is already taken',
      details: { email: 'a@b.c' },
    });
  });

  it('отдаёт необъявленную ошибку тем же путём, без стека', () => {
    const result = toCallToolResult(
      {
        isSuccess: false,
        status: 'internal_error',
        value: { error: 'Internal error', code: 'internal_error' },
      },
      true,
    );

    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      code: 'internal_error',
      message: 'Internal error',
    });
  });
});
