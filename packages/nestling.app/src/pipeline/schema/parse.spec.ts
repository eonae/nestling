import { parseMetadata, parsePayload } from './parse.js';
import type { InputSources } from './types.js';

import { SchemaValidationError } from '@common/misc';
import { z } from 'zod';

describe('parsePayload', () => {
  it('парсит и валидирует payload', () => {
    const schema = z.object({
      name: z.string().min(1),
      age: z.number(),
    });

    const sources: InputSources = {
      payload: {
        name: 'Alice',
        age: 30,
      },
      metadata: {},
    };

    const result = parsePayload(schema, sources);

    expect(result).toEqual({
      name: 'Alice',
      age: 30,
    });
  });

  it('бросает SchemaValidationError при ошибке валидации', () => {
    const schema = z.object({
      name: z.string().min(5),
    });

    const sources: InputSources = {
      payload: {
        name: 'Ab', // Слишком короткое
      },
      metadata: {},
    };

    expect(() => parsePayload(schema, sources)).toThrow(SchemaValidationError);
  });

  it('обрабатывает отсутствующие поля', () => {
    const schema = z.object({
      name: z.string().optional(),
    });

    const sources: InputSources = {
      payload: {},
      metadata: {},
    };

    const result = parsePayload(schema, sources);

    expect(result).toEqual({
      name: undefined,
    });
  });

  it('применяет преобразования схемы', () => {
    const schema = z.object({
      id: z.string().transform((val: string) => Number.parseInt(val, 10)),
    });

    const sources: InputSources = {
      payload: {
        id: '123',
      },
      metadata: {},
    };

    const result = parsePayload(schema, sources);

    expect(result.id).toBe(123);
    expect(typeof result.id).toBe('number');
  });
});

describe('parseMetadata', () => {
  it('парсит и валидирует metadata', () => {
    const schema = z.object({
      authorization: z.string(),
      userId: z.string().optional(),
    });

    const sources: InputSources = {
      payload: {},
      metadata: {
        authorization: 'Bearer token123',
        userId: 'user456',
      },
    };

    const result = parseMetadata(schema, sources);

    expect(result).toEqual({
      authorization: 'Bearer token123',
      userId: 'user456',
    });
  });

  it('бросает SchemaValidationError при ошибке валидации', () => {
    const schema = z.object({
      authorization: z.string().min(10),
    });

    const sources: InputSources = {
      payload: {},
      metadata: {
        authorization: 'short', // Слишком короткое
      },
    };

    expect(() => parseMetadata(schema, sources)).toThrow(SchemaValidationError);
  });

  it('обрабатывает отсутствующие поля metadata', () => {
    const schema = z.object({
      authorization: z.string().optional(),
    });

    const sources: InputSources = {
      payload: {},
      metadata: {},
    };

    const result = parseMetadata(schema, sources);

    expect(result).toEqual({
      authorization: undefined,
    });
  });
});

describe('SchemaValidationError', () => {
  it('несёт стандартные issues', () => {
    const issues = [{ message: 'too short', path: ['name'] }];

    const error = new SchemaValidationError('Test error', issues);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SchemaValidationError');
    expect(error.issues).toBe(issues);
    expect(error.message).toBe('Test error');
  });

  it('parsePayload нормализует issues в стандартную форму', () => {
    const schema = z.object({ name: z.string().min(5) });
    const sources: InputSources = { payload: { name: 'Ab' }, metadata: {} };

    try {
      parsePayload(schema, sources);
      throw new Error('Ожидалась SchemaValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      const { issues, message } = error as SchemaValidationError;
      expect(message).toBe('Payload validation failed');
      expect(issues[0].path).toEqual(['name']);
      expect(issues[0]).not.toHaveProperty('code');
    }
  });

  it('parseMetadata помечает отказ своим сообщением', () => {
    const schema = z.object({ authorization: z.string() });
    const sources: InputSources = { payload: {}, metadata: {} };

    try {
      parseMetadata(schema, sources);
      throw new Error('Ожидалась SchemaValidationError');
    } catch (error) {
      expect((error as SchemaValidationError).message).toBe(
        'Metadata validation failed',
      );
    }
  });
});
