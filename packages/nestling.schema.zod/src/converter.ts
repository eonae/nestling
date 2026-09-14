/**
 * Конвертер схем zod в JSON Schema — десять строк поверх `z.toJSONSchema()`.
 *
 * Конвертер — единственное место, знающее устройство конкретного валидатора:
 * ядро по вендору не ветвится и вендорские схемы не интроспектирует.
 */

import type { SchemaDocConverter } from '@nestlingjs/app';
import { z } from 'zod';

/** Опции `z.toJSONSchema` — принимаются как есть, кроме `io` */
export type ZodConverterOptions = Omit<
  NonNullable<Parameters<typeof z.toJSONSchema>[1]>,
  'io'
>;

/**
 * Конвертер схем zod.
 *
 * Направление (`io`) конвертер не выбирает: его называет вызывающий, потому
 * что знает, что описывает — тело запроса или тело ответа. Схема с
 * преобразованием (`z.string().transform(Number)`) даёт по сети строку, а
 * хендлеру число, и одна из этих форм всегда была бы неверной.
 * Без подсказки поведение штатное — то же, что у голого `z.toJSONSchema()`.
 *
 * @param options - Прочие опции `z.toJSONSchema` (`unrepresentable`,
 * `cycles`, `reused` и т. д.)
 * @returns Значение `SchemaDocConverter` с `vendor: 'zod'`
 *
 * @example Заменить умолчание своими опциями
 * ```typescript
 * makeOpenapi({ info: { title: 'My API', version: '1.0.0' },
 *           converters: [zodConverter({ unrepresentable: 'any' })] })
 * ```
 */
export function zodConverter(
  options: ZodConverterOptions = {},
): SchemaDocConverter {
  return {
    vendor: 'zod',
    toJsonSchema: (schema, hint) =>
      z.toJSONSchema(schema as z.ZodType, {
        ...options,
        ...(hint?.io === undefined ? {} : { io: hint.io }),
      }),
  };
}
