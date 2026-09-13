/**
 * Схемы, которые пишет сам фреймворк, переводит штатный конвертер.
 *
 * Раньше секции ядра приходили в снимок конфига исходом «конвертера нет»:
 * они были рукописными литералами с вендором, которого не знает ни один
 * конвертер. Теперь они написаны на zod, и снимок несёт для них настоящую
 * JSON Schema — с перечислением значений и умолчанием.
 */

import { zodConverter } from './converter.js';

import { describe, expect, it } from '@jest/globals';
import { describeConfig } from '@nestlingjs/app';

/** Описание одного ключа в снимке со штатным конвертером */
const keyOf = (name: string) =>
  describeConfig({ converters: [zodConverter()] })
    .sections.flatMap((section) => section.keys)
    .find((key) => key.key === name);

describe('секции ядра в снимке конфига', () => {
  it('NESTLING_LOG_LEVEL несёт перечисление значений и умолчание', () => {
    expect(keyOf('NESTLING_LOG_LEVEL')?.schema).toEqual({
      outcome: 'converted',
      vendor: 'zod',
      json: expect.objectContaining({
        type: 'string',
        enum: ['debug', 'info', 'warn', 'error', 'silent'],
        default: 'info',
      }),
    });
  });

  it('NESTLING_HEALTH_TIMEOUT несёт границу и умолчание', () => {
    expect(keyOf('NESTLING_HEALTH_TIMEOUT')?.schema).toEqual({
      outcome: 'converted',
      vendor: 'zod',
      json: expect.objectContaining({
        type: 'integer',
        minimum: 0,
        default: 2000,
      }),
    });
  });

  it('без конвертеров снимок остаётся прежним', () => {
    const key = describeConfig()
      .sections.flatMap((section) => section.keys)
      .find((one) => one.key === 'NESTLING_LOG_LEVEL');

    expect(key?.schema).toBeUndefined();
  });
});
