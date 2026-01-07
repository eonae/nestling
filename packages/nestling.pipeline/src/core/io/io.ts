import type { FilePart } from '../types';

import type { Infer, Optional, Schema } from '@common/misc';

/**
 * Примитивные типы входных данных
 */
export type IOPrimitive = 'binary' | 'text';

/**
 * Stream модификатор - данные приходят потоком
 */
export interface StreamModifier<T> {
  readonly __type: 'stream';
  readonly __schema: T;

  /**
   * Метаданные для транспорта
   */
  toJSON(): { type: 'stream'; schema: T };
}

/**
 * WithFiles модификатор - структурированные данные + файлы
 */
export interface WithFilesModifier<T> {
  readonly __type: 'withFiles';
  readonly __schema: T;
  readonly __filesOpts?: {
    buffer?: boolean; // загружать файлы в память
  };

  toJSON(): {
    type: 'withFiles';
    schema: T;
    filesOpts?: { buffer?: boolean };
  };
}

/**
 * Files модификатор - только файлы без схемы
 */
export interface FilesModifier {
  readonly __type: 'files';
  readonly __buffer?: boolean;

  toJSON(): { type: 'files'; buffer?: boolean };
}

/**
 * Input может быть:
 * - Schema (объект с валидацией)
 * - Примитив ('binary' | 'text')
 * - Модификатор (stream, withFiles, etc)
 */
export type Input<T extends Optional<Schema> = Optional<Schema>> =
  | T // Schema
  | IOPrimitive // Primitives
  | StreamModifier<T | IOPrimitive> // stream(schema)
  | WithFilesModifier<T> // withFiles(schema)
  | FilesModifier; // files()

/**
 * Output может быть:
 * - Schema (объект с валидацией)
 * - Примитив ('binary' | 'text')
 * - Stream модификатор
 */
export type Output<T = unknown> =
  | T // Schema
  | IOPrimitive // Primitives
  | StreamModifier<T>; // stream(schema)

/**
 * Выводит TypeScript тип из Input конфигурации
 */
export type InferInput<I> =
  // Примитивы
  I extends 'binary'
    ? Buffer
    : I extends 'text'
      ? string
      : // Stream модификатор
        I extends StreamModifier<infer S>
        ? AsyncIterableIterator<InferSchemaType<S>>
        : // WithFiles модификатор
          I extends WithFilesModifier<infer S>
          ? { data: InferSchemaType<S>; files: FilePart[] }
          : // Files модификатор
            I extends FilesModifier
            ? FilePart[]
            : // Undefined
              I extends undefined
              ? undefined
              : // Schema (по умолчанию)
                InferSchemaType<I>;

/**
 * Выводит TypeScript тип из Output конфигурации
 */
export type InferOutput<O> =
  // Примитивы
  O extends 'binary'
    ? Buffer
    : O extends 'text'
      ? string
      : // Stream модификатор
        O extends StreamModifier<infer S>
        ? AsyncIterableIterator<InferSchemaType<S>>
        : // Undefined
          O extends undefined
          ? undefined
          : // Schema (по умолчанию)
            InferSchemaType<O>;

/**
 * Вывод типа из схемы (zod, yup, etc) или примитива
 */
type InferSchemaType<S> = S extends 'binary'
  ? Buffer
  : S extends 'text'
    ? string
    : S extends { _output: infer O }
      ? O // zod
      : S extends { __outputType: infer O }
        ? O // yup
        : S extends Optional<Schema>
          ? Infer<S>
          : unknown;

/**
 * Результат анализа input конфигурации для транспорта
 */
export type InputConfig =
  | {
      type: 'stream';
      schema?: unknown;
    }
  | {
      type: 'withFiles';
      schema: unknown;
      options?: {
        buffer?: boolean;
      };
    }
  | {
      type: 'files';
      options?: {
        buffer?: boolean;
      };
    }
  | {
      type: 'schema';
      schema?: unknown;
    }
  | {
      type: 'primitive';
      primitive: 'binary' | 'text';
    };

/**
 * Создает stream модификатор
 *
 * @example
 * ```typescript
 * input: stream(LogSchema)
 * → payload: AsyncIterableIterator<Log>
 * ```
 */
export function stream<T extends Schema | IOPrimitive>(
  schema: T,
): StreamModifier<T> {
  return {
    __type: 'stream',
    __schema: schema,
    toJSON() {
      return {
        type: 'stream' as const,
        schema: schema,
      };
    },
  };
}

/**
 * Создает withFiles модификатор
 *
 * @example
 * ```typescript
 * input: withFiles(FormSchema)
 * → payload: { data: Form; files: FilePart[] }
 * ```
 */
export function withFiles<T extends Schema>(
  schema: T,
  opts?: { buffer?: boolean },
): WithFilesModifier<T> {
  return {
    __type: 'withFiles',
    __schema: schema,
    __filesOpts: opts,
    toJSON() {
      return {
        type: 'withFiles' as const,
        schema,
        filesOpts: opts,
      };
    },
  };
}

/**
 * Создает files модификатор
 *
 * @example
 * ```typescript
 * input: files()
 * → payload: FilePart[]
 * ```
 */
export function files(opts?: { buffer?: boolean }): FilesModifier {
  return {
    __type: 'files',
    __buffer: opts?.buffer,
    toJSON() {
      return {
        type: 'files' as const,
        buffer: opts?.buffer,
      };
    },
  };
}

/**
 * Анализирует input конфигурацию и возвращает метаданные для транспорта
 *
 * @param input - Input конфигурация (Schema, модификатор или примитив)
 * @returns Нормализованная конфигурация для транспорта
 */
export function analyzeInput(input?: unknown): InputConfig {
  // Undefined
  if (input === undefined) {
    return { type: 'schema' as const, schema: undefined };
  }

  // Примитивы
  if (input === 'binary' || input === 'text') {
    return { type: 'primitive' as const, primitive: input };
  }

  // Модификаторы (проверяем __type поле)
  if (typeof input === 'object' && input !== null) {
    const modifier = input as any;

    if (modifier.__type === 'stream') {
      return {
        type: 'stream' as const,
        schema: modifier.__schema,
      };
    }

    if (modifier.__type === 'withFiles') {
      return {
        type: 'withFiles' as const,
        schema: modifier.__schema,
        options: modifier.__filesOpts,
      };
    }

    if (modifier.__type === 'files') {
      return {
        type: 'files' as const,
        options: { buffer: modifier.__buffer },
      };
    }
  }

  // Обычная схема (zod, yup, etc)
  return { type: 'schema' as const, schema: input };
}
