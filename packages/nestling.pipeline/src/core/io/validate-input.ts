/**
 * Проверка входа endpoint'а по схеме `input`.
 *
 * Живёт в ядре рядом с рантаймом потоковых форм: проверка входа —
 * обязанность рантайма пайплайна, одинаковая для всех транспортов и для
 * `app.call`. Транспорт собирает значение, рантайм его проверяет.
 */

import type { Schema } from '@common/misc';
import { SchemaValidationError, validateSync } from '@common/misc';
import type { FormDescriptor } from '@nestling/operations';
import { BadRequest, isPrimitiveLeaf } from '@nestling/operations';

/** Payload формы `multipart`: поля формы и файлы */
interface MultipartPayload {
  fields?: unknown;
  files?: unknown;
}

/**
 * Превращает отказ схемы в отказ ядра `BadRequest`.
 *
 * Ошибки конфигурации приложения — async-схема
 * (`AsyncSchemaNotSupportedError`) и объект-не-схема
 * (`NotAStandardSchemaError`) — пробрасываются как есть: это не ошибка
 * входа, и 400 их бы замаскировал.
 */
function check(schema: Schema, value: unknown): unknown {
  try {
    return validateSync(schema, value, 'Validation failed');
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      throw BadRequest(error.issues, { cause: error });
    }

    throw error;
  }
}

/**
 * Проверяет кандидата по форме `input` и возвращает выход схемы.
 *
 * Что проверяется, зависит от формы:
 *
 * - форма значения со схемой-листом — кандидат целиком;
 * - форма значения с примитивным листом (`binary`, `text`) и форма без
 *   объявленного `input` — ничего, кандидат возвращается как есть;
 * - `multipart` — поля формы схемой `fields`, файлы возвращаются той же
 *   ссылкой;
 * - `stream` и `events` — ничего: элементы проверяет `bindInputStream`
 *   по одному во время чтения.
 *
 * @param form - описатель формы `input` декларации
 * @param candidate - значение на проверку: `payload` из контекста, если
 * его положил `.pre`-юнит, иначе `raw.payload`
 * @returns выход схемы, то есть результат её трансформаций
 * @throws Fail отказ `bad_request` (400), если значение не прошло схему
 */
export function validateInput(
  form: FormDescriptor,
  candidate: unknown,
): unknown {
  if (form.kind === 'multipart') {
    const payload = (candidate ?? {}) as MultipartPayload;

    return {
      fields: form.fields ? check(form.fields, payload.fields) : payload.fields,
      files: payload.files,
    };
  }

  if (form.kind !== 'value') {
    return candidate;
  }

  if (form.leaf === undefined || isPrimitiveLeaf(form.leaf)) {
    return candidate;
  }

  return check(form.leaf as Schema, candidate);
}
