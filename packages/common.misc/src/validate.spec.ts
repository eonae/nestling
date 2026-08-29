import {
  AsyncSchemaNotSupportedError,
  NotAStandardSchemaError,
  SchemaValidationError,
} from './errors.js';
// Спека — единственная зависимость пакета, и она types-only: потребителям
// тип приходит реэкспортом отсюда, ставить `@standard-schema/spec` не нужно.
import type { Infer, Schema, StandardSchemaV1 } from './types.js';
import { validateSync } from './validate.js';

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

/**
 * Сигнатура потребителя: тип `Schema` приходит реэкспортом из `@common/misc`,
 * пакет `@standard-schema/spec` в зависимостях этого пакета не значится.
 */
const describeSchema = (schema: Schema): string => schema['~standard'].vendor;

/** Схема-заглушка: `validate` возвращает то, что ей задали. */
function fakeSchema<T>(
  validate: StandardSchemaV1.Props<unknown, T>['validate'],
): StandardSchemaV1<unknown, T> {
  return {
    '~standard': { version: 1, vendor: 'test', validate },
  };
}

describe('validateSync — успех', () => {
  it('возвращает разобранное значение', () => {
    const schema = z.object({ name: z.string() });

    expect(validateSync(schema, { name: 'Alice' }, 'failed')).toEqual({
      name: 'Alice',
    });
  });

  it('отдаёт выход схемы, а не вход, если схема трансформирует', () => {
    const schema = z.object({
      id: z.string().transform((value: string) => Number.parseInt(value, 10)),
    });

    const result = validateSync(schema, { id: '123' }, 'failed');

    expect(result.id).toBe(123);
    expect(typeof result.id).toBe('number');
  });

  it('работает с любой Standard Schema, не только с zod', () => {
    const schema = fakeSchema<{ ok: true }>(() => ({ value: { ok: true } }));

    expect(validateSync(schema, 'что угодно', 'failed')).toEqual({ ok: true });
  });
});

describe('validateSync — issues', () => {
  it('бросает SchemaValidationError с путём поля', () => {
    const schema = z.object({ name: z.string() });

    try {
      validateSync(schema, { name: 42 }, 'Payload validation failed');
      throw new Error('Ожидалась SchemaValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      const { issues } = error as SchemaValidationError;
      expect(issues).toHaveLength(1);
      expect(typeof issues[0].message).toBe('string');
      expect(issues[0].message.length).toBeGreaterThan(0);
      expect(issues[0].path).toEqual(['name']);
    }
  });

  it('сохраняет числовой индекс во вложенном пути', () => {
    const schema = z.object({
      items: z.array(z.object({ id: z.string() })),
    });

    try {
      validateSync(schema, { items: [{ id: 1 }] }, 'failed');
      throw new Error('Ожидалась SchemaValidationError');
    } catch (error) {
      const { issues } = error as SchemaValidationError;
      expect(issues[0].path).toEqual(['items', 0, 'id']);
    }
  });

  it('сериализуется в JSON без потерь', () => {
    const schema = z.object({
      items: z.array(z.object({ id: z.string() })),
    });

    try {
      validateSync(schema, { items: [{ id: 1 }] }, 'failed');
      throw new Error('Ожидалась SchemaValidationError');
    } catch (error) {
      const { issues } = error as SchemaValidationError;

      // Проверяется именно JSON-сериализуемость (issues попадают в тело
      // HTTP-ответа), поэтому structuredClone здесь не заменяет round-trip.
      // eslint-disable-next-line unicorn/prefer-structured-clone
      expect(JSON.parse(JSON.stringify(issues))).toEqual([
        { message: issues[0].message, path: ['items', 0, 'id'] },
      ]);
    }
  });

  it('разворачивает сегмент-объект `{ key }` и приводит символ к строке', () => {
    const marker = Symbol('marker');
    const schema = fakeSchema(() => ({
      issues: [
        { message: 'вложенный', path: [{ key: 'user' }, { key: 0 }, 'id'] },
        { message: 'символ', path: [marker] },
        { message: 'без пути' },
      ],
    }));

    try {
      validateSync(schema, {}, 'failed');
      throw new Error('Ожидалась SchemaValidationError');
    } catch (error) {
      const { issues } = error as SchemaValidationError;

      expect(issues).toEqual([
        { message: 'вложенный', path: ['user', 0, 'id'] },
        { message: 'символ', path: [String(marker)] },
        { message: 'без пути' },
      ]);
      expect('path' in issues[2]).toBe(false);
    }
  });

  it('переносит переданное сообщение в ошибку', () => {
    const schema = z.string();

    expect(() =>
      validateSync(schema, 42, 'Metadata validation failed'),
    ).toThrow('Metadata validation failed');
  });
});

describe('validateSync — синхронность как гарантия', () => {
  const asyncSchema = fakeSchema(() =>
    Promise.resolve({ value: { ok: true } }),
  );

  it('бросает AsyncSchemaNotSupportedError на thenable-результат', () => {
    expect(() => validateSync(asyncSchema, {}, 'failed')).toThrow(
      AsyncSchemaNotSupportedError,
    );
  });

  it('async-ошибка не выдаёт себя за ошибку валидации', () => {
    try {
      validateSync(asyncSchema, {}, 'failed');
      throw new Error('Ожидалась AsyncSchemaNotSupportedError');
    } catch (error) {
      expect(error).not.toBeInstanceOf(SchemaValidationError);
      expect((error as Error).message).toMatch(/synchronous/i);
    }
  });
});

describe('validateSync — объект не является Standard Schema', () => {
  it('бросает NotAStandardSchemaError на объект без `~standard`', () => {
    const notASchema = {
      parse: (value: unknown) => value,
    } as unknown as Schema;

    try {
      validateSync(notASchema, {}, 'failed');
      throw new Error('Ожидалась NotAStandardSchemaError');
    } catch (error) {
      expect(error).toBeInstanceOf(NotAStandardSchemaError);
      expect(error).not.toBeInstanceOf(SchemaValidationError);
      expect((error as Error).message).toMatch(/Standard Schema/);
      expect((error as Error).message).toMatch(/zod ≥ 3\.24/);
    }
  });

  it('бросает NotAStandardSchemaError на чужую версию спеки', () => {
    const v2 = {
      '~standard': { version: 2, vendor: 'future', validate: () => ({}) },
    } as unknown as Schema;

    expect(() => validateSync(v2, {}, 'failed')).toThrow(
      NotAStandardSchemaError,
    );
  });
});

describe('типы схем', () => {
  it('Schema и Infer работают без прямой зависимости на спеку', () => {
    const objectSchema = z.object({ name: z.string(), age: z.number() });

    expect(describeSchema(z.string())).toBe('zod');
    expect(describeSchema(objectSchema)).toBe('zod');

    assertType<Equal<Infer<undefined>, undefined>>(true);
    assertType<
      Equal<Infer<typeof objectSchema>, { name: string; age: number }>
    >(true);
  });
});
