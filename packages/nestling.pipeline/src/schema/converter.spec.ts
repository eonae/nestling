/**
 * Конвертер — операция схемного слоя, а не механизм валидации.
 *
 * Тест сторожит обе стороны этого утверждения: диспетчер выбирает по
 * вендору и молчит, когда конвертера нет, — и ни одна схемная граница от
 * присутствия конвертеров не зависит.
 */

import type { SchemaDocConverter } from './converter.js';
import {
  assertConverters,
  leafJsonSchema,
  pickConverter,
  schemaVendorOf,
} from './converter.js';
import { parsePayload } from './parse.js';

import { SchemaValidationError, validateSync } from '@common/misc';
import { jsonSchema, jsonSchemaOf } from '@nestling/contracts';
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

describe('jsonSchema — аннотация схемного слоя', () => {
  const Exotic = z.object({ id: z.string() });

  it('аннотированная схема валидирует ровно как исходная', () => {
    const annotated = jsonSchema(Exotic, { type: 'object' });

    expect(validateSync(annotated, { id: '1' }, 'failed')).toEqual({ id: '1' });
    expect(() => validateSync(annotated, { id: 1 }, 'failed')).toThrow(
      SchemaValidationError,
    );
  });

  it('issues аннотированной схемы совпадают с issues исходной', () => {
    const annotated = jsonSchema(Exotic, { type: 'object' });

    const issuesOf = (schema: typeof Exotic): unknown => {
      try {
        validateSync(schema, { id: 1 }, 'failed');
      } catch (error) {
        return (error as SchemaValidationError).issues;
      }
      return undefined;
    };

    expect(issuesOf(annotated)).toEqual(issuesOf(Exotic));
  });

  it('исходная схема не мутирована', () => {
    jsonSchema(Exotic, { type: 'object' });

    expect(jsonSchemaOf(Exotic)).toBeUndefined();
    expect(
      Object.getOwnPropertySymbols(Exotic).map((s) => s.toString()),
    ).not.toContain('Symbol(nestling:json-schema)');
  });

  it('аннотация читается диспетчером при пустом списке конвертеров', () => {
    const annotated = jsonSchema(Exotic, { type: 'object', title: 'Exotic' });

    expect(leafJsonSchema([], annotated)).toEqual({
      outcome: 'declared',
      vendor: 'zod',
      json: { type: 'object', title: 'Exotic' },
    });
  });

  it('аннотация приоритетнее подходящего конвертера', () => {
    let calls = 0;
    const counting: SchemaDocConverter = {
      vendor: 'zod',
      toJsonSchema: (schema) => {
        calls += 1;
        return z.toJSONSchema(schema as z.ZodType);
      },
    };
    const annotated = jsonSchema(Exotic, { type: 'object', title: 'declared' });

    expect(leafJsonSchema([counting], annotated)).toMatchObject({
      outcome: 'declared',
      json: { title: 'declared' },
    });
    expect(calls).toBe(0);
  });

  it('без аннотации диспетчер зовёт конвертер, а без него сообщает вендор', () => {
    expect(leafJsonSchema([zodConverter()], Exotic)).toMatchObject({
      outcome: 'converted',
      vendor: 'zod',
    });
    expect(leafJsonSchema([], Exotic)).toEqual({
      outcome: 'unconvertible',
      vendor: 'zod',
    });
    expect(leafJsonSchema([], 'binary')).toBeUndefined();
  });

  it('не-схема и отсутствующая JSON Schema отвергаются в точке аннотации', () => {
    expect(() => jsonSchema({} as never, { type: 'object' })).toThrow(
      /must be a Standard Schema value/,
    );
    // JS-потребителя типы не сдерживают: забытый второй аргумент обязан
    // падать понятным текстом, а не молча давать схему без аннотации
    expect(() =>
      (jsonSchema as (schema: unknown, json?: unknown) => unknown)(Exotic),
    ).toThrow(/declared JSON Schema is required/);
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
