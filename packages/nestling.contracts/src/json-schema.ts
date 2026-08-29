/**
 * `jsonSchema(schema, json)`: явное объявление JSON Schema для схемы.
 *
 * Standard Schema не даёт интроспекции, поэтому JSON Schema обычно строит
 * конвертер вендора. Аннотация — второй путь: JSON Schema объявляется
 * рядом со схемой, и конвертер для неё не нужен.
 *
 * Аннотация объявлена здесь, а не в пакете конвертеров, по двум причинам:
 * ею пользуются схемы самого ядра (`details` отказов ядра), и её должен
 * уметь ставить автор контракта, а контракт импортируется во фронтенд без
 * серверных пакетов.
 */

import type { StandardSchemaV1 } from '@common/misc';

/**
 * Symbol-свойство, в котором хранится объявленная JSON Schema.
 *
 * Неперечислимое: аннотированное значение остаётся обычной схемой для
 * спреда, `Object.keys` и валидации.
 */
const JSON_SCHEMA_ANNOTATION = Symbol.for('nestling:json-schema');

/** Возвращает вендора схемы или `undefined`, если значение не Standard Schema */
function vendorOf(schema: unknown): string | undefined {
  const props =
    typeof schema === 'object' && schema !== null && '~standard' in schema
      ? (schema as StandardSchemaV1)['~standard']
      : undefined;

  return typeof props?.vendor === 'string' ? props.vendor : undefined;
}

/**
 * Объявляет JSON Schema для схемы явно.
 *
 * Возвращает новое значение, которое наследует исходную схему через
 * прототип: `~standard` тот же, поэтому аннотированная схема валидирует
 * так же, как исходная, и подходит в любую позицию схемы (`input`,
 * `output`, лист потоковой формы, `fields` у `multipart`, `details`
 * определения отказа). Исходная схема не меняется; глобального реестра
 * аннотаций нет.
 *
 * Если аннотация есть, конвертер (`toJsonSchema`) не вызывается.
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

  // Наследование через прототип, а не копирование: `~standard` остаётся
  // тем же значением, поэтому валидация не меняется.
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
 * Возвращает объявленную аннотацией JSON Schema или `undefined`, если
 * аннотации нет. Значение `undefined` в самой аннотации невозможно:
 * `jsonSchema` его отвергает.
 */
export function jsonSchemaOf(leaf: unknown): unknown {
  if (typeof leaf !== 'object' || leaf === null) {
    return undefined;
  }

  return (leaf as Record<symbol, unknown>)[JSON_SCHEMA_ANNOTATION];
}
