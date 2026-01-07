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

  it('should throw error on duplicate keys', () => {
    const body = { id: '123' };
    const params = { id: '456' };

    expect(() => mergePayload(body, undefined, params)).toThrow(
      'Duplicate key "id" found in payload sources',
    );
  });

  it('should throw error on duplicate keys between body and query', () => {
    const body = { name: 'Alice' };
    const query = { name: 'Bob' };

    expect(() => mergePayload(body, query)).toThrow(
      'Duplicate key "name" found in payload sources',
    );
  });

  it('should handle non-object sources gracefully', () => {
    const body = { name: 'Alice' };
    const query = null;
    const params = undefined;

    const result = mergePayload(body, query, params);

    expect(result).toEqual({ name: 'Alice' });
  });
});
