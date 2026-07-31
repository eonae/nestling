import type { AnyPayload, EmptyInput } from '../core';
import { Fail } from '../core';
import type { EndpointMeta, ExtendableContext } from '../core/types/context';
import { makeEmptyContext } from '../core/types/context';

import { validate } from './validate.js';

import type { Schema, StandardSchemaV1 } from '@common/misc';
import {
  AsyncSchemaNotSupportedError,
  NotAStandardSchemaError,
} from '@common/misc';
import { z } from 'zod';

function makeCtx(
  input: AnyPayload | undefined,
  payload: unknown,
): ExtendableContext<EmptyInput> {
  const endpoint: EndpointMeta = {
    transport: 'test',
    pattern: 'TEST /',
    input,
  };

  return makeEmptyContext(
    {
      transport: 'test',
      pattern: 'TEST /',
      payload,
      attributes: {},
    },
    endpoint,
  );
}

/** Схема-заглушка: `validate` возвращает то, что ей задали. */
function fakeSchema<T>(
  validateFn: StandardSchemaV1.Props<unknown, T>['validate'],
): StandardSchemaV1<unknown, T> {
  return {
    '~standard': { version: 1, vendor: 'test', validate: validateFn },
  };
}

describe('validate() — ошибка входа', () => {
  it('отдаёт выход схемы в payload', async () => {
    const schema = z.object({
      id: z.string().transform((value: string) => Number.parseInt(value, 10)),
    });

    const result = await validate()(makeCtx(schema, { id: '42' }));

    expect(result).toEqual({ payload: { id: 42 } });
  });

  it('превращает отказ валидации в Fail.badRequest со стандартными issues', async () => {
    const schema = z.object({ name: z.string() });

    try {
      await validate()(makeCtx(schema, { name: 42 }));
      throw new Error('Ожидался Fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Fail);
      const fail = error as Fail;
      expect(fail.status).toBe('BAD_REQUEST');
      expect(fail.details).toEqual([
        { message: expect.any(String), path: ['name'] },
      ]);
    }
  });

  it('пропускает не-schema input', async () => {
    const result = await validate()(makeCtx('binary', Buffer.from('x')));

    expect(result).toBeUndefined();
  });
});

describe('validate() — ошибка конфигурации приложения', () => {
  it('async-схема не превращается в Fail.badRequest', async () => {
    const asyncSchema = fakeSchema(() =>
      Promise.resolve({ value: { ok: true } }),
    );

    await expect(validate()(makeCtx(asyncSchema, {}))).rejects.toBeInstanceOf(
      AsyncSchemaNotSupportedError,
    );
    await expect(
      validate()(makeCtx(asyncSchema, {})),
    ).rejects.not.toBeInstanceOf(Fail);
  });

  it('объект-не-схема не превращается в Fail.badRequest', async () => {
    const notASchema = {
      parse: (value: unknown) => value,
    } as unknown as Schema;

    await expect(validate()(makeCtx(notASchema, {}))).rejects.toBeInstanceOf(
      NotAStandardSchemaError,
    );
    await expect(
      validate()(makeCtx(notASchema, {})),
    ).rejects.not.toBeInstanceOf(Fail);
  });
});
