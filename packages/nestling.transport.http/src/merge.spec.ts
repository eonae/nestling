import { PayloadConflictError } from './errors.js';
import { mergePayload } from './merge.js';

describe('mergePayload', () => {
  it('should merge body, query and params', () => {
    const body = { name: 'Alice', email: 'alice@example.com' };
    const query = { page: '1', limit: '10' };
    const params = { id: '123' };

    const result = mergePayload(body, query, params);

    expect(result).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
      page: '1',
      limit: '10',
      id: '123',
    });
  });

  it('should handle undefined sources', () => {
    const body = { name: 'Alice' };
    const result = mergePayload(body);

    expect(result).toEqual({ name: 'Alice' });
  });

  it('should handle empty objects', () => {
    const result = mergePayload({}, {}, {});

    expect(result).toEqual({});
  });

  it('should throw PayloadConflictError on duplicate keys', () => {
    const body = { id: '123' };
    const params = { id: '456' };

    expect(() => mergePayload(body, undefined, params)).toThrow(
      PayloadConflictError,
    );
    expect(() => mergePayload(body, undefined, params)).toThrow(
      'Duplicate key "id" found in payload sources',
    );
  });

  it('should expose the conflicting key on the error', () => {
    const body = { name: 'Alice' };
    const query = { name: 'Bob' };

    try {
      mergePayload(body, query);
      throw new Error('expected mergePayload to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PayloadConflictError);
      expect((error as PayloadConflictError).key).toBe('name');
    }
  });

  it('should handle non-object sources gracefully', () => {
    const body = { name: 'Alice' };
    const query = null;
    const params = undefined;

    const result = mergePayload(body, query, params);

    expect(result).toEqual({ name: 'Alice' });
  });
});
