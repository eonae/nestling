/**
 * `@nestling/openapi.zod` — конвертер схем zod в JSON Schema.
 *
 * Весь пакет это десять строк поверх штатного `z.toJSONSchema()`, и так и
 * задумано: конвертер — единственное место, знающее устройство конкретного
 * валидатора, и живёт он **отдельным пакетом**, потому что его мажоры
 * следуют за мажорами валидатора, а не за мажорами фреймворка. Пользователь
 * ставит ровно то, чем пользуется; `zod` здесь peer-зависимость.
 *
 * Реестра «вендор → конвертер» внутри `@nestling/openapi` нет: список
 * конвертеров это данные вызывающего, и даже в стопроцентно-zod приложении
 * конвертер называется явно одной строкой. Цена explicit over implicit
 * посчитана в журнале решений и принята.
 */

import type { SchemaDocConverter } from '@nestling/pipeline';
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
 * @example
 * ```typescript
 * openapi({ info: { title: 'My API', version: '1.0.0' },
 *           converters: [zodConverter()] })
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
