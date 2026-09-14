/**
 * Пустое значение ключа — то же, что незаданный ключ.
 *
 * Правило живёт в ядре одной точкой, поэтому проверяется на обоих путях
 * чтения: проекции секции из графа и первичном чтении фазы 0.
 */

import { objectSource } from './__fixtures__/object-source.js';
import { ConfigValidationError } from './errors.js';
import { readSectionSnapshot } from './kernel.js';
import { load } from './load.js';
import { ConfigReader } from './reader.js';
import { makeConfig } from './section.js';
import { bind } from './source.js';

import { beforeEach, describe, expect, it } from '@jest/globals';
import { z } from 'zod';

const BlankConfig = makeConfig('blank', {
  port: z.coerce.number().int().min(1).default(3000),
});

const RequiredConfig = makeConfig('required', {
  url: z.string().min(1),
});

/** Читалка с одним источником поверх пустого окружения */
const readerOf = async (
  ...sources: Record<string, string>[]
): Promise<ConfigReader> => {
  const reader = new ConfigReader(
    sources.map((values, index) =>
      bind(objectSource(values, `source-${index}`)),
    ),
  );
  await reader.init();

  return reader;
};

beforeEach(() => {
  delete process.env.BLANK_PORT;
  delete process.env.REQUIRED_URL;
});

describe('проекция секции из графа', () => {
  it('пустой ключ даёт умолчание схемы', async () => {
    const reader = await readerOf({ BLANK_PORT: '' });

    expect(readSectionSnapshot('blank', reader)).toEqual({ port: 3000 });
  });

  it('пустой ключ у обязательного поля даёт отказ с именем ключа', async () => {
    const reader = await readerOf({ REQUIRED_URL: '' });

    expect(() => readSectionSnapshot('required', reader)).toThrow(
      ConfigValidationError,
    );
    expect(() => readSectionSnapshot('required', reader)).toThrow(
      /REQUIRED_URL/,
    );
  });

  it('пустое значение не уводит читалку к следующему источнику', async () => {
    const reader = await readerOf({ BLANK_PORT: '' }, { BLANK_PORT: '8080' });

    expect(readSectionSnapshot('blank', reader)).toEqual({ port: 3000 });
  });
});

describe('первичное чтение фазы 0', () => {
  it('ведёт себя так же, как проекция из графа', () => {
    process.env.BLANK_PORT = '';

    expect(load(BlankConfig)).toEqual({ port: 3000 });
  });

  it('пустой ключ у обязательного поля даёт тот же отказ', () => {
    process.env.REQUIRED_URL = '';

    expect(() => load(RequiredConfig)).toThrow(ConfigValidationError);
  });
});
