/**
 * Вендор-конвертеры схем: единственный способ узнать устройство схемы.
 *
 * Standard Schema непрозрачна в рантайме — спека покрывает валидацию и
 * инференс, интроспекции в ней нет. Всё, что требует знания структуры,
 * во фреймворке устроено явно; конвертер и есть это «явно»: он живёт
 * снаружи ядра, знает конкретный валидатор и отдаёт JSON Schema.
 *
 * Операция заводится **нейтральным**, на схемном слое, потому что
 * потребителей у него два и строгость у них разная:
 *
 * | Потребитель | Нет конвертера для вендора |
 * |---|---|
 * | генератор документации (`@nestling/openapi`) | fail-fast на boot |
 * | снапшот операций (`@nestling/ports`) | лист непрозрачен → вердикт `unknown` |
 *
 * Поэтому диспетчер строгость не зашивает: он возвращает «конвертера
 * нет» наблюдаемым исходом, а решение принимает вызывающий.
 */

import type { StandardSchemaV1 } from '@common/misc';
import { jsonSchemaOf } from '@nestling/contracts';

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

  /**
   * Переводит схему этого вендора в JSON Schema.
   *
   * Второй параметр опционален с обеих сторон: конвертер может его
   * игнорировать (функция одного аргумента остаётся валидным конвертером),
   * а вызывающий — не передавать, если направление ему безразлично.
   */
  toJsonSchema(schema: StandardSchemaV1, options?: SchemaDocOptions): unknown;
}

/**
 * Направление конвертации: какую сторону схемы описывает результат.
 *
 * Различие не педантизм, а свойство сериализации. Схема с преобразованием
 * (`z.string().transform(Number)`, `z.stringbool()`) описывает **две**
 * формы: то, что приходит по сети, и то, что получает хендлер. Документ
 * запроса обязан описывать первую, документ ответа — вторую, и без
 * подсказки конвертер выбрал бы одну на оба случая.
 *
 * Подсказка **необязательна**: потребителю, которому направление
 * безразлично (снапшот операций сравнивает форму с самой собой),
 * передавать её незачем.
 */
export interface SchemaDocOptions {
  /** `input` — форма по сети. `output` — форма после преобразований */
  readonly io?: 'input' | 'output';
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

// ---------------------------------------------------------------------------
// Диспетчер листа: аннотация, конвертер, «конвертера нет»
// ---------------------------------------------------------------------------

/**
 * Как получить JSON Schema для листа — **три различимых исхода**.
 *
 * «Схему объявили аннотацией», «схему сконвертировали» и «конвертера нет»
 * разведены намеренно: первые два дают JSON Schema, но передаются из
 * разных источников (и разница видна в диагностике), а третий это ровно
 * та ситуация, строгость к которой выбирает потребитель.
 */
export type LeafJsonSchema =
  /** Объявлена аннотацией `jsonSchema(schema, json)` */
  | {
      readonly outcome: 'declared';
      readonly vendor: string;
      readonly json: unknown;
    }
  /** Получена конвертером своего вендора */
  | {
      readonly outcome: 'converted';
      readonly vendor: string;
      readonly json: unknown;
    }
  /** Конвертера для вендора нет и аннотации тоже */
  | { readonly outcome: 'unconvertible'; readonly vendor: string };

/**
 * Диспетчер листа перебирает источники по порядку: аннотация, конвертер,
 * а если ни один не сработал — исход «конвертера нет».
 *
 * Единственная точка, где эти три исхода различаются, — и оба потребителя
 * операции (снапшот операций и генератор документации) читают её, а не
 * повторяют порядок предпочтений у себя.
 *
 * @param converters - Список конвертеров вызывающего
 * @param leaf - Лист формы
 * @returns Исход или `undefined`, если лист вообще не Standard Schema
 */
export function leafJsonSchema(
  converters: readonly SchemaDocConverter[] | undefined,
  leaf: unknown,
  options?: SchemaDocOptions,
): LeafJsonSchema | undefined {
  const vendor = schemaVendorOf(leaf);
  if (vendor === undefined) {
    return undefined;
  }

  const declared = jsonSchemaOf(leaf);
  if (declared !== undefined) {
    return { outcome: 'declared', vendor, json: declared };
  }

  const converter = pickConverter(converters, leaf);
  if (!converter) {
    return { outcome: 'unconvertible', vendor };
  }

  return {
    outcome: 'converted',
    vendor,
    json: converter.toJsonSchema(leaf as StandardSchemaV1, options),
  };
}
