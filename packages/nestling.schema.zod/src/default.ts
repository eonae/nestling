/**
 * Разрешение списка конвертеров: конвертер zod подставляется умолчанием.
 *
 * Схемы фреймворка написаны на zod, поэтому потребитель JSON Schema —
 * генератор документа, определения инструментов агента, вопросы
 * CLI-транспорта — обязан уметь их перевести и без строки в опциях.
 * Реестра «вендор — конвертер» при этом не появляется: умолчание
 * подставляет сам потребитель в той точке, где читает список вызывающего.
 */

import { zodConverter } from './converter.js';

import type { SchemaDocConverter } from '@nestlingjs/app';

/**
 * Дописывает конвертер zod к списку вызывающего.
 *
 * Отсюда обе половины обещания: список **добавляет** конвертер другого
 * вендора, не теряя zod, и **заменяет** конвертер zod, если в нём есть
 * свой. Отсутствие списка и пустой список дают один и тот же результат.
 *
 * Проверку на два конвертера одного вендора внутри списка вызывающего
 * функция не отменяет: `assertConverters` идёт до неё.
 *
 * @param converters - Список из опций потребителя
 * @returns Список, в котором конвертер вендора `zod` есть ровно один
 *
 * @example
 * ```typescript
 * const resolved = withZodDefault(options.converters);
 * ```
 */
export function withZodDefault(
  converters?: readonly SchemaDocConverter[],
): readonly SchemaDocConverter[] {
  if (converters?.some((converter) => converter.vendor === 'zod')) {
    return converters;
  }

  return [...(converters ?? []), zodConverter()];
}
