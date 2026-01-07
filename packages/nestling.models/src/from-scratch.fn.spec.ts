import { fromScratch } from './from-scratch.fn';

import { z } from 'zod';

describe('makeModel', () => {
  it('should create schema without explicit type (type inference)', () => {
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

  it('should return zod schema directly', () => {
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

describe('transforms with makeModel (without explicit type)', () => {
  it('should support transforms without type parameter', () => {
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

  it('should support complex transforms', () => {
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
