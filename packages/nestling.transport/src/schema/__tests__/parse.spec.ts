import {
  parseMetadata,
  parsePayload,
  SchemaValidationError,
} from '../parse.js';
import type { InputSources } from '../types.js';

import { z } from 'zod';

describe('parsePayload', () => {
  it('should parse and validate payload', () => {
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

  it('should throw SchemaValidationError on validation failure', () => {
    const schema = z.object({
      name: z.string().min(5),
    });

    const sources: InputSources = {
      payload: {
        name: 'Ab', // Too short
      },
      metadata: {},
    };

    expect(() => parsePayload(schema, sources)).toThrow(SchemaValidationError);
  });

  it('should handle missing fields', () => {
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

  it('should apply transformations', () => {
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
  it('should parse and validate metadata', () => {
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

  it('should throw SchemaValidationError on validation failure', () => {
    const schema = z.object({
      authorization: z.string().min(10),
    });

    const sources: InputSources = {
      payload: {},
      metadata: {
        authorization: 'short', // Too short
      },
    };

    expect(() => parseMetadata(schema, sources)).toThrow(SchemaValidationError);
  });

  it('should handle missing metadata fields', () => {
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
  it('should contain zod error', () => {
    const parseResult = z.string().min(5).safeParse('ab');
    if (!parseResult.error) {
      throw new Error('Expected validation error');
    }
    const zodError = parseResult.error;

    const error = new SchemaValidationError('Test error', zodError);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SchemaValidationError');
    expect(error.zodError).toBe(zodError);
    expect(error.message).toBe('Test error');
  });
});
