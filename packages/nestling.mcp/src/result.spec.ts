/**
 * Отображение результата операции на результат вызова инструмента.
 *
 * Отказ доходит до агента результатом с `isError: true`, а не ошибкой
 * протокола: объявленный отказ — часть контракта операции.
 */

import { toCallToolResult } from './result.js';

import { describe, expect, it } from '@jest/globals';
import { Fail, InternalError, makeFail, Ok } from '@nestlingjs/app';
import { z } from 'zod';

const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} is already taken`,
});

describe('toCallToolResult(result, structured)', () => {
  it('отдаёт успех текстом JSON и структурой', () => {
    const result = toCallToolResult(new Ok({ id: 'u-1' }), true);

    expect(result).toEqual({
      content: [{ type: 'text', text: '{"id":"u-1"}' }],
      structuredContent: { id: 'u-1' },
    });
    expect(result.isError).toBeUndefined();
  });

  it('не отдаёт структуру, когда схема выхода не объявлена', () => {
    const result = toCallToolResult(new Ok(42), false);

    expect(result).toEqual({ content: [{ type: 'text', text: '42' }] });
  });

  it('отдаёт объявленный отказ с кодом, сообщением и деталями', () => {
    const result = toCallToolResult(EmailTaken({ email: 'a@b.c' }), true);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({
      code: 'conflict:email_taken',
      message: 'Email a@b.c is already taken',
      details: { email: 'a@b.c' },
    });
  });

  it('отдаёт отказ ядра тем же путём и без деталей исключения', () => {
    const result = toCallToolResult(InternalError(), true);

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      code: 'internal_error',
      message: 'Internal server error',
    });
  });

  it('отдаёт отказ без деталей одним кодом и сообщением', () => {
    const result = toCallToolResult(Fail.notFound('User not found'), false);

    expect(JSON.parse(result.content[0].text)).toEqual({
      code: 'not_found',
      message: 'User not found',
    });
  });
});
