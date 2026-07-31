/**
 * Вендор-конвертеры схем: единственный способ узнать устройство схемы.
 *
 * Standard Schema непрозрачна в рантайме — спека покрывает валидацию и
 * инференс, интроспекции в ней нет. Всё, что требует знания структуры,
 * во фреймворке устроено явно; конвертер и есть это «явно»: он живёт
 * снаружи ядра, знает конкретный валидатор и отдаёт JSON Schema.
 *
 * Контракт заводится **нейтральным**, на схемном слое, потому что
 * потребителей у него два и строгость у них разная:
 *
 * | Потребитель | Нет конвертера для вендора |
 * |---|---|
 * | генератор документации (`@nestling/openapi`) | fail-fast на boot |
 * | снапшот контрактов (`@nestling/ports`) | лист непрозрачен → вердикт `unknown` |
 *
 * Поэтому диспетчер строгость не зашивает: он возвращает «конвертера
 * нет» наблюдаемым исходом, а решение принимает вызывающий.
 */

import type { StandardSchemaV1 } from '@common/misc';

/**
 * Конвертер схем одного вендора в JSON Schema.
 *
 * Единственное место, знающее устройство конкретного валидатора: ядро по
 * вендору не ветвится и вендорские схемы не интроспектирует. Пишется в
 * десять строк поверх штатного конвертера валидатора
 * (`z.toJSONSchema()` и аналоги) и живёт отдельным пакетом.
 *
 * @example
 * ```typescript
 * const zodConverter = (): SchemaDocConverter => ({
 *   vendor: 'zod',
 *   toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
 * });
 * ```
 */
export interface SchemaDocConverter {
  /** Значение `~standard.vendor` схем, которые конвертер понимает */
  readonly vendor: string;

  /** Переводит схему этого вендора в JSON Schema */
  toJsonSchema(schema: StandardSchemaV1): unknown;
}

/**
 * Вендор схемы — `~standard.vendor`, если значение вообще Standard Schema.
 *
 * Не бросает: вызывается там, где отсутствие схемы это штатный исход
 * (лист формы может быть примитивом или не быть объявлен вовсе).
 */
export function schemaVendorOf(schema: unknown): string | undefined {
  const props =
    typeof schema === 'object' && schema !== null && '~standard' in schema
      ? (schema as StandardSchemaV1)['~standard']
      : undefined;

  return typeof props?.vendor === 'string' ? props.vendor : undefined;
}

/**
 * Fail-fast списка конвертеров — **в точке передачи списка**.
 *
 * Глобального реестра конвертеров не существует: список это данные
 * вызывающего. Два конвертера одного вендора в одном списке делают выбор
 * недетерминированным, поэтому отвергаются сразу, а не молча разрешаются
 * порядком элементов.
 *
 * @param converters - Список, переданный потребителем
 * @throws {Error} Если два элемента списка объявляют один `vendor`
 */
export function assertConverters(
  converters?: readonly SchemaDocConverter[],
): void {
  if (converters === undefined) {
    return;
  }

  if (!Array.isArray(converters)) {
    throw new TypeError(
      `'converters' must be an array of SchemaDocConverter values ` +
        `({ vendor, toJsonSchema }).`,
    );
  }

  const seen = new Set<string>();

  for (const [index, converter] of converters.entries()) {
    const vendor = (converter as SchemaDocConverter | undefined)?.vendor;

    if (typeof vendor !== 'string' || vendor.length === 0) {
      throw new TypeError(
        `converters[${index}] is not a schema converter — expected ` +
          `{ vendor: string, toJsonSchema(schema) }.`,
      );
    }

    if (typeof converter.toJsonSchema !== 'function') {
      throw new TypeError(
        `Schema converter for vendor '${vendor}' has no 'toJsonSchema' ` +
          `function.`,
      );
    }

    if (seen.has(vendor)) {
      throw new Error(
        `Two schema converters declare the same vendor '${vendor}'. ` +
          `A vendor selects exactly one converter, so the list must not ` +
          `contain duplicates — drop one of them.`,
      );
    }
    seen.add(vendor);
  }
}

/**
 * Выбирает конвертер по вендору схемы.
 *
 * Отсутствие конвертера — **наблюдаемый исход** (`undefined`), а не
 * бросок: строгость выбирает вызывающий (см. таблицу потребителей в
 * шапке модуля).
 *
 * @param converters - Список конвертеров вызывающего
 * @param schema - Лист формы, для которого нужна JSON Schema
 * @returns Конвертер или `undefined`, если вендор неизвестен списку
 */
export function pickConverter(
  converters: readonly SchemaDocConverter[] | undefined,
  schema: unknown,
): SchemaDocConverter | undefined {
  if (!converters || converters.length === 0) {
    return undefined;
  }

  const vendor = schemaVendorOf(schema);
  if (vendor === undefined) {
    return undefined;
  }

  return converters.find((converter) => converter.vendor === vendor);
}
