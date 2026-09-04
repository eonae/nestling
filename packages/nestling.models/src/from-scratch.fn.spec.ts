import { fromScratch } from './from-scratch.fn.js';

import { z } from 'zod';

describe('makeModel', () => {
  it('создаёт схему без явного типа: тип выводится автоматически', () => {
    const schema = fromScratch().makeModel(
      z.object({
        a: z.number().describe('First number'),
        b: z.string().describe('Second value'),
      }),
    );

    expect(schema).toBeDefined();
    expect(schema.shape).toHaveProperty('a');
    expect(schema.shape).toHaveProperty('b');
  });

  it('возвращает объект схемы zod без изменений', () => {
    const schema = fromScratch().makeModel(
      z.object({
        field1: z.string().describe('Field 1'),
        field2: z.number().describe('Field 2'),
      }),
    );

    expect(schema).toBeDefined();
    expect(schema).toBeInstanceOf(z.ZodObject);
  });
});

describe('преобразования в makeModel без явного типа', () => {
  it('поддерживает transform без явного параметра типа', () => {
    const schema = fromScratch().makeModel(
      z.object({
        id: z.string().transform((val) => Number.parseInt(val, 10)),
        name: z.string(),
      }),
    );

    expect(schema).toBeDefined();

    const result = schema.parse({ id: '123', name: 'Alice' });
    expect(result.id).toBe(123);
    expect(result.name).toBe('Alice');
  });

  it('поддерживает составные преобразования полей', () => {
    const schema = fromScratch().makeModel(
      z.object({
        email: z.email().transform((val) => val.toLowerCase()),
        createdAt: z.iso.datetime().transform((val) => new Date(val)),
      }),
    );

    expect(schema).toBeDefined();

    const result = schema.parse({
      email: 'USER@EXAMPLE.COM',
      createdAt: '2024-01-01T00:00:00Z',
    });

    expect(result.email).toBe('user@example.com');
    expect(result.createdAt).toBeInstanceOf(Date);
  });
});
