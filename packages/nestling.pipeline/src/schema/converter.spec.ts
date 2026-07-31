/**
 * Конвертер — контракт схемного слоя, а не механизм валидации.
 *
 * Тест сторожит обе стороны этого утверждения: диспетчер выбирает по
 * вендору и молчит, когда конвертера нет, — и ни одна схемная граница от
 * присутствия конвертеров не зависит.
 */

import type { SchemaDocConverter } from './converter.js';
import {
  assertConverters,
  pickConverter,
  schemaVendorOf,
} from './converter.js';
import { parsePayload } from './parse.js';

import { SchemaValidationError, validateSync } from '@common/misc';
import { z } from 'zod';

const zodConverter = (): SchemaDocConverter => ({
  vendor: 'zod',
  toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
});

const valibotish = (): SchemaDocConverter => ({
  vendor: 'valibot',
  toJsonSchema: () => ({ type: 'string' }),
});

describe('pickConverter', () => {
  it('выбирает конвертер по вендору схемы', () => {
    const converters = [valibotish(), zodConverter()];
    const schema = z.object({ id: z.string() });

    const picked = pickConverter(converters, schema);

    expect(picked?.vendor).toBe('zod');
    expect(picked?.toJsonSchema(schema)).toMatchObject({ type: 'object' });
  });

  it('пустой список даёт «конвертера нет» без броска', () => {
    expect(pickConverter([], z.string())).toBeUndefined();
    expect(pickConverter(undefined, z.string())).toBeUndefined();
  });

  it('незнакомый вендор — тоже наблюдаемый исход, а не ошибка', () => {
    expect(pickConverter([valibotish()], z.string())).toBeUndefined();
  });

  it('значение без `~standard` конвертера не получает', () => {
    expect(pickConverter([zodConverter()], 'binary')).toBeUndefined();
    expect(pickConverter([zodConverter()], null)).toBeUndefined();
  });
});

describe('schemaVendorOf', () => {
  it('читает вендор Standard Schema', () => {
    expect(schemaVendorOf(z.string())).toBe('zod');
  });

  it('на не-схеме даёт undefined', () => {
    expect(schemaVendorOf('text')).toBeUndefined();
    expect(schemaVendorOf(null)).toBeUndefined();
    expect(schemaVendorOf({})).toBeUndefined();
  });
});

describe('assertConverters', () => {
  it('дубль вендора бросает, называя вендор', () => {
    expect(() => assertConverters([zodConverter(), zodConverter()])).toThrow(
      /same vendor 'zod'/,
    );
  });

  it('пропускает корректный список и отсутствие списка', () => {
    expect(() =>
      assertConverters([zodConverter(), valibotish()]),
    ).not.toThrow();
    expect(() => assertConverters()).not.toThrow();
  });

  it('элемент не той формы бросает с индексом', () => {
    expect(() =>
      assertConverters([{ toJsonSchema: () => ({}) } as never]),
    ).toThrow(/converters\[0] is not a schema converter/);

    expect(() => assertConverters([{ vendor: 'zod' } as never])).toThrow(
      /vendor 'zod' has no 'toJsonSchema'/,
    );
  });
});

describe('конвертеры к валидации отношения не имеют', () => {
  it('validateSync работает без единого конвертера', () => {
    const schema = z.object({ id: z.string() });

    expect(validateSync(schema, { id: '1' }, 'failed')).toEqual({ id: '1' });
    expect(() => validateSync(schema, { id: 1 }, 'failed')).toThrow(
      SchemaValidationError,
    );
  });

  it('на схемной границе конвертеров нет ни в одной сигнатуре', () => {
    // Регрессия: `parsePayload` — та же функция двух аргументов, что была
    // до появления конвертеров
    expect(parsePayload.length).toBe(2);
    expect(
      parsePayload(z.object({ id: z.string() }), {
        payload: { id: '1' },
        metadata: {},
      }),
    ).toEqual({ id: '1' });
  });
});
