import type { FilePart } from '../types';

import type { InferInput, InferOutput } from './io';
import { analyzePayload, files, stream, withFiles } from './io';

import { z } from 'zod';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/**
 * Тип-утверждение: инстанциация с ложным `Equal<…>` не проходит компиляцию
 * (`false` не удовлетворяет ограничению `true`).
 */
const assertType = <T extends true>(assertion: T): T => assertion;

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

describe('инференс типов из io-конфигурации', () => {
  it('выводит выход схемы через ~standard, без вендорских ветвлений', () => {
    const schema = z.object({
      id: z.string().transform((value: string) => Number.parseInt(value, 10)),
    });

    // Инференс идёт по `~standard.types.output`: у трансформирующей схемы
    // это выход, а не вход.
    assertType<Equal<InferInput<typeof schema>, { id: number }>>(true);
    assertType<
      Equal<
        InferInput<ReturnType<typeof stream<typeof schema>>>,
        AsyncIterableIterator<{ id: number }>
      >
    >(true);
    assertType<
      Equal<
        InferInput<ReturnType<typeof withFiles<typeof schema>>>,
        { data: { id: number }; files: FilePart[] }
      >
    >(true);
    assertType<Equal<InferOutput<typeof schema>, { id: number }>>(true);

    expect(analyzePayload(schema).type).toBe('schema');
  });

  it('сохраняет ветки примитивов и undefined', () => {
    assertType<Equal<InferInput<'binary'>, Buffer>>(true);
    assertType<Equal<InferInput<'text'>, string>>(true);
    assertType<Equal<InferInput<undefined>, undefined>>(true);
    assertType<
      Equal<
        InferInput<ReturnType<typeof stream<'text'>>>,
        AsyncIterableIterator<string>
      >
    >(true);
    assertType<Equal<InferInput<ReturnType<typeof files>>, FilePart[]>>(true);

    expect(analyzePayload('text').type).toBe('primitive');
  });
});

describe('analyzeInput', () => {
  it('should analyze undefined input', () => {
    const result = analyzePayload();

    expect(result).toEqual({
      type: 'schema',
      schema: undefined,
    });
  });

  it('should analyze primitive input', () => {
    expect(analyzePayload('binary')).toEqual({
      type: 'primitive',
      primitive: 'binary',
    });

    expect(analyzePayload('text')).toEqual({
      type: 'primitive',
      primitive: 'text',
    });
  });

  it('should analyze stream modifier', () => {
    const schema = z.object({ id: z.string() });
    const modifier = stream(schema);
    const result = analyzePayload(modifier);

    expect(result).toEqual({
      type: 'stream',
      schema,
    });
  });

  it('should analyze withFiles modifier', () => {
    const schema = z.object({ title: z.string() });
    const modifier = withFiles(schema, { buffer: true });
    const result = analyzePayload(modifier);

    expect(result).toEqual({
      type: 'withFiles',
      schema,
      options: { buffer: true },
    });
  });

  it('should analyze files modifier', () => {
    const modifier = files({ buffer: true });
    const result = analyzePayload(modifier);

    expect(result).toEqual({
      type: 'files',
      options: { buffer: true },
    });
  });

  it('should analyze schema input', () => {
    const schema = z.object({ name: z.string() });
    const result = analyzePayload(schema);

    expect(result).toEqual({
      type: 'schema',
      schema,
    });
  });
});
