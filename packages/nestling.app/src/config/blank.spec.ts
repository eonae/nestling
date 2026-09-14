/**
 * Пустое значение ключа — то же, что незаданный ключ.
 *
 * Правило живёт в ядре одной точкой — проекции секции из графа.
 */

import { objectSource } from './__fixtures__/object-source.js';
import { ConfigValidationError } from './errors.js';
import { readSectionSnapshot } from './kernel.js';
import { ConfigReader } from './reader.js';
import { makeConfig } from './section.js';
import { bind } from './source.js';

import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

makeConfig('blank', {
  port: z.coerce.number().int().min(1).default(3000),
});

makeConfig('required', {
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
