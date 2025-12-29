import type { RequestContext } from '../../core/interfaces.js';
import { createInputSources, extractDescription } from '../helpers.js';

import { z } from 'zod';

describe('createInputSources', () => {
  it('should create InputSources from RequestContext', () => {
    const ctx: RequestContext = {
      transport: 'http',
      method: 'POST',
      path: '/users/123',
      payload: {
        name: 'Alice',
        email: 'alice@example.com',
        include: 'profile',
        id: '123',
      },
      metadata: {
        authorization: 'Bearer token123',
        'content-type': 'application/json',
        requestId: 'req-456',
      },
    };

    const sources = createInputSources(ctx);

    expect(sources.payload).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
      include: 'profile',
      id: '123',
    });

    expect(sources.metadata).toEqual({
      authorization: 'Bearer token123',
      'content-type': 'application/json',
      requestId: 'req-456',
    });
  });

  it('should handle missing optional fields', () => {
    const ctx: RequestContext = {
      transport: 'http',
      method: 'GET',
      path: '/users',
      payload: undefined,
      metadata: {},
    };

    const sources = createInputSources(ctx);

    expect(sources.payload).toEqual({});
    expect(sources.metadata).toEqual({});
  });

  it('should extract payload and metadata from context', () => {
    const ctx: RequestContext = {
      transport: 'http',
      method: 'GET',
      path: '/users',
      payload: {
        id: '123',
      },
      metadata: {
        authorization: 'Bearer token',
        userId: '123',
      },
    };

    const sources = createInputSources(ctx);

    expect(sources.payload).toEqual({
      id: '123',
    });

    expect(sources.metadata).toEqual({
      authorization: 'Bearer token',
      userId: '123',
    });
  });
});

describe('extractDescription', () => {
  it('should extract descriptions from schema', () => {
    const schema = z.object({
      name: z.string().describe('User name'),
      email: z.string().describe('User email'),
      age: z.number(),
    });

    const descriptions = extractDescription(schema);

    expect(descriptions).toEqual({
      name: 'User name',
      email: 'User email',
      age: undefined,
    });
  });

  it('should handle schema without descriptions', () => {
    const schema = z.object({
      field1: z.string(),
      field2: z.number(),
    });

    const descriptions = extractDescription(schema);

    expect(descriptions).toEqual({
      field1: undefined,
      field2: undefined,
    });
  });

  it('should handle empty schema', () => {
    const schema = z.object({});

    const descriptions = extractDescription(schema);

    expect(descriptions).toEqual({});
  });
});
