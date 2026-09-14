/**
 * Билдер отдаёт открытое значение: границу и умолчание дописывает
 * вызывающий, и проверяется здесь именно это — цепочка работает.
 */

import { flag, int } from './builders.js';
import { zodConverter } from './converter.js';

import { leafJsonSchema } from '@nestlingjs/app';
import { describe, expect, it } from 'vitest';

describe('int', () => {
  it('принимает границу и умолчание цепочкой', () => {
    const field = int().min(0).default(60_000);

    // `parse` требует аргумент: «значения нет» это явный `undefined`
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(field.parse(undefined)).toBe(60_000);
    expect(() => field.parse(-1)).toThrow();
  });

  it('приводит строку из окружения к числу', () => {
    expect(int().min(1).parse('500')).toBe(500);
  });

  it('отвергает дробное значение', () => {
    expect(() => int().parse('1.5')).toThrow();
  });
});

describe('flag', () => {
  it('принимает обе записи', () => {
    const field = flag().default(false);

    expect(field.parse('true')).toBe(true);
    expect(field.parse(true)).toBe(true);
    expect(field.parse('off')).toBe(false);
  });

  it('отдаёт умолчание, когда значения нет', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(flag().default(true).parse(undefined)).toBe(true);
  });
});

describe('поле секции и конвертер приложения', () => {
  it('переводится штатным конвертером в JSON Schema', () => {
    const resolved = leafJsonSchema(
      [zodConverter()],
      int().min(1).default(500),
    );

    expect(resolved).toEqual({
      outcome: 'converted',
      vendor: 'zod',
      json: expect.objectContaining({
        type: 'integer',
        minimum: 1,
        default: 500,
      }),
    });
  });
});
