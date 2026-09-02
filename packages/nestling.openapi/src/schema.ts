/**
 * Схемный слой генератора: перевод листа в JSON Schema и разбор результата.
 *
 * Генератор разбирает **JSON Schema на выходе конвертера**, а не вендорскую
 * схему: интроспекции у Standard Schema нет, и заглядывать в потроха
 * валидатора — не его дело. Отсюда и форма диагностики: «конвертера для
 * вендора нет» это ситуация, о которой надо сказать, а не обойти.
 */

import type { Diagnostics } from './diagnostics.js';
import type { JsonSchemaObject, JsonValue } from './types.js';

import type { SchemaDocConverter } from '@nestling/pipeline';
import { isPrimitiveLeaf, leafJsonSchema } from '@nestling/pipeline';

/** Контекст конвертации одного endpoint'а */
export interface ConvertContext {
  readonly converters?: readonly SchemaDocConverter[];
  readonly diagnostics: Diagnostics;

  /** Координаты endpoint'а для текста диагностики */
  readonly where: string;
}

/**
 * Переводит лист формы в JSON Schema, копя нарушения вместо броска.
 *
 * Направление обязательно: тело запроса описывается формой **как получено
 * по сети**, тело ответа — формой после преобразований. Схема с `transform`
 * без этой подсказки описала бы не то, что реально передаётся.
 *
 * @param leaf - Лист формы: схема, примитив (`'binary'`/`'text'`) или ничто
 * @param slot - Имя слота для диагностики: `input`, `output`,
 * `errors['EMAIL_TAKEN'].details`, `multipart fields`
 * @param io - Какую сторону схемы описывает результат
 * @returns JSON Schema либо `undefined` — если листа нет или он не покрыт
 */
export function convertLeaf(
  leaf: unknown,
  slot: string,
  context: ConvertContext,
  io: 'input' | 'output',
): JsonValue | undefined {
  if (leaf === undefined || leaf === null) {
    return undefined;
  }

  if (isPrimitiveLeaf(leaf)) {
    return leaf === 'binary'
      ? { type: 'string', format: 'binary' }
      : { type: 'string' };
  }

  let resolved: ReturnType<typeof leafJsonSchema>;

  try {
    resolved = leafJsonSchema(context.converters, leaf, { io });
  } catch (error) {
    // Конвертер отказался переводить схему (у zod так ведёт себя, например,
    // непредставимый `z.date()` на выходе). Без этой ветки ошибка ушла бы
    // наружу без координат — а автору нужно знать, какой endpoint и какой
    // слот
    context.diagnostics.add(
      context.where,
      `its '${slot}' schema could not be converted to JSON Schema: ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        `Declare the schema explicitly with jsonSchema(schema, { … }), or ` +
        `replace the unrepresentable part of it.`,
    );
    return undefined;
  }

  if (!resolved) {
    // Не Standard Schema и не примитив: описывать нечего, и притворяться,
    // что схема есть, хуже, чем не описать её вовсе
    return undefined;
  }

  if (resolved.outcome === 'unconvertible') {
    context.diagnostics.add(
      context.where,
      `the '${slot}' schema is a '${resolved.vendor}' schema, and no ` +
        `converter for that vendor was passed. Either add one to ` +
        `'converters' (for example zodConverter() from ` +
        `@nestling/openapi.zod), or declare the schema explicitly with ` +
        `jsonSchema(schema, { … }).`,
    );
    return undefined;
  }

  return asJson(resolved.json);
}

/**
 * Приводит вывод конвертера к JSON-значению.
 *
 * Ключи не сортируются (в отличие от снапшота операций): документ
 * читают глазами, и порядок полей схемы, заданный её автором, полезнее
 * алфавитного. Отбрасываются только `undefined` и функции — они всё равно
 * не переживут `JSON.stringify`.
 */
function asJson(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => asJson(item));
  }

  switch (typeof value) {
    case 'boolean':
    case 'string': {
      return value;
    }
    case 'number': {
      return Number.isFinite(value) ? value : null;
    }
    case 'object': {
      const source = value as Record<string, unknown>;
      const result: Record<string, JsonValue> = {};

      for (const [key, item] of Object.entries(source)) {
        if (item === undefined || typeof item === 'function') {
          continue;
        }
        result[key] = asJson(item);
      }

      return result;
    }
    default: {
      return null;
    }
  }
}

/** Разложимая схема: объект со свойствами */
export interface ObjectSchema {
  readonly properties: Record<string, JsonValue>;
  readonly required: readonly string[];

  /** Остальные ключи схемы — переносятся в тело как есть */
  readonly rest: Record<string, JsonValue>;
}

/**
 * Читает конвертированную схему как объект со свойствами.
 *
 * `undefined` означает «разложить нечего»: схема не объект либо свойств у
 * неё нет. Решение, ошибка это или нет, принимает вызывающий — оно зависит
 * от того, требует ли bind-карта что-то оттуда вынести.
 */
export function readObjectSchema(
  json: JsonValue | undefined,
): ObjectSchema | undefined {
  if (
    json === null ||
    json === undefined ||
    typeof json !== 'object' ||
    Array.isArray(json)
  ) {
    return undefined;
  }

  const source = json as JsonSchemaObject;
  const properties = source.properties;

  if (
    properties === null ||
    properties === undefined ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    return undefined;
  }

  const required = Array.isArray(source.required)
    ? source.required.filter((name): name is string => typeof name === 'string')
    : [];

  const rest: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key !== 'properties' && key !== 'required') {
      rest[key] = value;
    }
  }

  return {
    properties: { ...(properties as Record<string, JsonValue>) },
    required,
    rest,
  };
}
