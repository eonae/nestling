/**
 * Умолчание обязано и добавляться к чужому списку, и уступать своему
 * конвертеру zod: обе половины обещания проверяются здесь.
 */

import { zodConverter } from './converter.js';
import { withZodDefault } from './default.js';

import { describe, expect, it } from '@jest/globals';
import type { SchemaDocConverter } from '@nestlingjs/app';

/** Конвертер чужого вендора: наружу от него нужен только `vendor` */
const valibotish: SchemaDocConverter = {
  vendor: 'valibot',
  toJsonSchema: () => ({}),
};

describe('withZodDefault', () => {
  it('подставляет конвертер zod, когда списка нет', () => {
    expect(withZodDefault().map((one) => one.vendor)).toEqual(['zod']);
  });

  it('даёт тот же результат на пустом списке', () => {
    expect(withZodDefault([]).map((one) => one.vendor)).toEqual(['zod']);
  });

  it('добавляет конвертер zod к чужому вендору, не вытесняя его', () => {
    expect(withZodDefault([valibotish]).map((one) => one.vendor)).toEqual([
      'valibot',
      'zod',
    ]);
  });

  it('уступает конвертеру zod из списка вызывающего', () => {
    const own = zodConverter({ unrepresentable: 'any' });
    const resolved = withZodDefault([own]);

    expect(resolved).toEqual([own]);
    expect(resolved.filter((one) => one.vendor === 'zod')).toHaveLength(1);
  });
});
