import { analyzeInput, files, stream, withFiles } from './io';

import { z } from 'zod';

describe('stream', () => {
  it('should create stream modifier with schema', () => {
    const schema = z.object({ id: z.string() });
    const modifier = stream(schema);

    expect(modifier.__type).toBe('stream');
    expect(modifier.__schema).toBe(schema);
    expect(modifier.toJSON()).toEqual({
      type: 'stream',
      schema,
    });
  });

  it('should create stream modifier with primitive', () => {
    const modifier = stream('binary');

    expect(modifier.__type).toBe('stream');
    expect(modifier.__schema).toBe('binary');
    expect(modifier.toJSON()).toEqual({
      type: 'stream',
      schema: 'binary',
    });
  });
});

describe('withFiles', () => {
  it('should create withFiles modifier', () => {
    const schema = z.object({ title: z.string() });
    const modifier = withFiles(schema);

    expect(modifier.__type).toBe('withFiles');
    expect(modifier.__schema).toBe(schema);
    expect(modifier.__filesOpts).toBeUndefined();
    expect(modifier.toJSON()).toEqual({
      type: 'withFiles',
      schema,
      filesOpts: undefined,
    });
  });

  it('should create withFiles modifier with options', () => {
    const schema = z.object({ title: z.string() });
    const modifier = withFiles(schema, { buffer: true });

    expect(modifier.__type).toBe('withFiles');
    expect(modifier.__schema).toBe(schema);
    expect(modifier.__filesOpts).toEqual({ buffer: true });
    expect(modifier.toJSON()).toEqual({
      type: 'withFiles',
      schema,
      filesOpts: { buffer: true },
    });
  });
});

describe('files', () => {
  it('should create files modifier', () => {
    const modifier = files();

    expect(modifier.__type).toBe('files');
    expect(modifier.__buffer).toBeUndefined();
    expect(modifier.toJSON()).toEqual({
      type: 'files',
      buffer: undefined,
    });
  });

  it('should create files modifier with buffer option', () => {
    const modifier = files({ buffer: true });

    expect(modifier.__type).toBe('files');
    expect(modifier.__buffer).toBe(true);
    expect(modifier.toJSON()).toEqual({
      type: 'files',
      buffer: true,
    });
  });
});

describe('analyzeInput', () => {
  it('should analyze undefined input', () => {
    const result = analyzeInput();

    expect(result).toEqual({
      type: 'schema',
      schema: undefined,
    });
  });

  it('should analyze primitive input', () => {
    expect(analyzeInput('binary')).toEqual({
      type: 'primitive',
      primitive: 'binary',
    });

    expect(analyzeInput('text')).toEqual({
      type: 'primitive',
      primitive: 'text',
    });
  });

  it('should analyze stream modifier', () => {
    const schema = z.object({ id: z.string() });
    const modifier = stream(schema);
    const result = analyzeInput(modifier);

    expect(result).toEqual({
      type: 'stream',
      schema,
    });
  });

  it('should analyze withFiles modifier', () => {
    const schema = z.object({ title: z.string() });
    const modifier = withFiles(schema, { buffer: true });
    const result = analyzeInput(modifier);

    expect(result).toEqual({
      type: 'withFiles',
      schema,
      options: { buffer: true },
    });
  });

  it('should analyze files modifier', () => {
    const modifier = files({ buffer: true });
    const result = analyzeInput(modifier);

    expect(result).toEqual({
      type: 'files',
      options: { buffer: true },
    });
  });

  it('should analyze schema input', () => {
    const schema = z.object({ name: z.string() });
    const result = analyzeInput(schema);

    expect(result).toEqual({
      type: 'schema',
      schema,
    });
  });
});
