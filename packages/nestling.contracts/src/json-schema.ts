/**
 * `jsonSchema(schema, json)` — escape hatch схемного слоя.
 *
 * Standard Schema интроспекции не даёт, поэтому путь «схема → JSON Schema»
 * идёт через вендор-конвертер. Аннотация — второй путь, ручной: она
 * объявляет ответ прямо рядом со схемой, и конвертер для этого листа больше
 * не нужен.
 *
 * Дом аннотации здесь, а не в пакете конвертеров, по двум причинам. Первая:
 * ею объявлены схемы **самого ядра** (`details` kernel-отказов написаны
 * руками — Standard Schema это интерфейс, а не библиотека, — и вендора
 * `nestling` ни один конвертер не понимает). Вторая: аннотировать лист
 * обязан уметь автор контракта, а контракт импортируется во фронт, где
 * серверных пакетов нет. Диспетчер, который её читает, живёт вместе с
 * `SchemaDocConverter` — там, где есть кого с ней сравнивать.
 */

import type { StandardSchemaV1 } from '@common/misc';

/**
 * Symbol-бренд аннотации, несущий объявленную JSON Schema.
 *
 * Неперечислимый, как бренд декларации и bind-карты: аннотированное
 * значение остаётся обычной схемой (спред, `Object.keys`, сама валидация
 * его не замечают).
 */
const JSON_SCHEMA_ANNOTATION = Symbol.for('nestling:json-schema');

/** Вендор значения, если оно вообще Standard Schema */
function vendorOf(schema: unknown): string | undefined {
  const props =
    typeof schema === 'object' && schema !== null && '~standard' in schema
      ? (schema as StandardSchemaV1)['~standard']
      : undefined;

  return typeof props?.vendor === 'string' ? props.vendor : undefined;
}

/**
 * Объявляет JSON Schema для листа явно.
 *
 * Возвращает **новое значение**, наследующее исходную схему через прототип:
 * `~standard` тот же самый, поэтому аннотированная схема валидирует ровно
 * как исходная и годится в любую схемную позицию — `input`, `output`, лист
 * потоковой формы, `fields` формы `multipart`, `details` определения
 * отказа. Исходная схема не мутируется, глобального реестра аннотаций нет:
 * ответ на вопрос «как выглядит эта схема» едет тем же значением, что и
 * сама схема.
 *
 * Аннотация приоритетнее конвертера: если она есть, `toJsonSchema` не
 * зовётся вовсе.
 *
 * @param schema - Исходная схема; её валидация сохраняется без изменений
 * @param json - Объявленная JSON Schema (JSON-значение)
 * @returns Схему-двойник с объявленной JSON Schema
 * @throws {TypeError} Значение не Standard Schema либо `json` не передан
 *
 * @example
 * ```typescript
 * input: z.object({ payload: jsonSchema(ExoticSchema, { type: 'object' }) })
 * ```
 */
export function jsonSchema<S extends StandardSchemaV1>(
  schema: S,
  json: unknown,
): S {
  if (vendorOf(schema) === undefined) {
    throw new TypeError(
      `jsonSchema(schema, json): the first argument must be a Standard ` +
        `Schema value (an object with a '~standard' property) — the ` +
        `annotation declares how an existing schema looks, it does not ` +
        `create one.`,
    );
  }

  if (json === undefined) {
    throw new TypeError(
      `jsonSchema(schema, json): the declared JSON Schema is required — ` +
        `an annotation without it says nothing that the converter would ` +
        `not say better.`,
    );
  }

  // Прототипное наследование, а не копирование: `~standard` (и всё
  // остальное, чем схема пользуется) остаётся тем же значением, поэтому
  // валидация аннотированной схемы тождественна валидации исходной.
  const annotated = Object.create(schema as object) as S;

  Object.defineProperty(annotated, JSON_SCHEMA_ANNOTATION, {
    value: json,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return annotated;
}

/**
 * Объявленная аннотацией JSON Schema, если она есть.
 *
 * `undefined` означает «аннотации нет» — не «схема пустая»: `jsonSchema`
 * отвергает `undefined` в аргументе именно затем, чтобы эти два случая не
 * сливались.
 */
export function jsonSchemaOf(leaf: unknown): unknown {
  if (typeof leaf !== 'object' || leaf === null) {
    return undefined;
  }

  return (leaf as Record<symbol, unknown>)[JSON_SCHEMA_ANNOTATION];
}
