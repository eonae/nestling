/**
 * Конвертер обязан быть тонким: он не «наш формат JSON Schema», а вывод
 * штатного конвертера валидатора, взятый как есть.
 */

import { zodConverter } from './index.js';

import { describe, expect, it } from '@jest/globals';
import { leafJsonSchema } from '@nestling/pipeline';
import { z } from 'zod';

describe('zodConverter', () => {
  const User = z.object({
    id: z.string(),
    age: z.number().optional(),
    tags: z.array(z.string()),
  });

  it('отдаёт ровно то, что отдал бы прямой вызов z.toJSONSchema()', () => {
    expect(zodConverter().toJsonSchema(User)).toEqual(z.toJSONSchema(User));
  });

  it('объявляет вендор zod и выбирается диспетчером схемного слоя', () => {
    expect(zodConverter().vendor).toBe('zod');

    expect(leafJsonSchema([zodConverter()], User)).toEqual({
      outcome: 'converted',
      vendor: 'zod',
      json: z.toJSONSchema(User),
    });
  });

  it('без него лист остаётся неконвертируемым', () => {
    expect(leafJsonSchema([], User)).toEqual({
      outcome: 'unconvertible',
      vendor: 'zod',
    });
  });
});

describe('направление конвертации', () => {
  // Схема с преобразованием описывает две формы: строку по сети и число
  // у хендлера. Одна из них всегда была бы неверной без подсказки
  const Search = z.object({ limit: z.string().transform(Number).optional() });

  it('io: input описывает форму, полученную по сети', () => {
    expect(zodConverter().toJsonSchema(Search, { io: 'input' })).toMatchObject({
      properties: { limit: { type: 'string' } },
    });
  });

  it('io: output — форму после преобразований', () => {
    expect(
      zodConverter().toJsonSchema(z.object({ n: z.number() }), {
        io: 'output',
      }),
    ).toMatchObject({ properties: { n: { type: 'number' } } });
  });

  it('прочие опции z.toJSONSchema принимаются как есть', () => {
    expect(
      zodConverter({ unrepresentable: 'any' }).toJsonSchema(Search),
    ).toEqual(z.toJSONSchema(Search, { unrepresentable: 'any' }));
  });
});
