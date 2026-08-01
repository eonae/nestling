/**
 * `responses`: весь контракт границы, а не только счастливый путь.
 *
 * Множество ответов ручки закрыто как `E ∪ UnknownError` (модель ошибок),
 * и документ обязан это отражать: объявленные отказы, автоматический `400`
 * от валидации входа и `default` — незадекларированное, приведённое
 * границей к `UNKNOWN`.
 *
 * Тело отказа описывается **тем, что реально пишет транспорт**:
 * `{ error, code, details? }`. Придумывать здесь RFC 9457 нельзя — документ
 * описывает текущий провод, а не желаемый.
 */

import type { ConvertContext } from './schema.js';
import { convertLeaf } from './schema.js';
import type { JsonValue, OpenApiResponse } from './types.js';

import type { AnyFailDefinition, DeclarationDoc } from '@nestling/contracts';
import { UnknownError, ValidationFailed } from '@nestling/contracts';
import { describeForm, mediaTypeOf } from '@nestling/pipeline';
import { httpCodeOf } from '@nestling/transport.http';

/** Что генератор знает об ответах ручки */
export interface ResponsesInput {
  readonly output: unknown;
  readonly errors?: readonly AnyFailDefinition[];
  readonly doc?: DeclarationDoc;

  /** Объявлена ли у ручки схема входа: от этого зависит автоматический 400 */
  readonly hasInputSchema: boolean;
}

/** Ответы операции по кодам провода плюс `default` */
export type Responses = Record<string, OpenApiResponse>;

export function planResponses(
  input: ResponsesInput,
  context: ConvertContext,
): Responses {
  const responses: Responses = {};

  const [successCode, success] = planSuccess(input, context);
  responses[successCode] = success;

  // Отказы группируются по коду провода: у двух определений с одним
  // статусом код совпадает, и второе не должно затирать первое
  const byCode = new Map<string, JsonValue[]>();

  const declared = [...(input.errors ?? [])];

  // Валидация входа отвечает независимо от `errors:` — это kernel-код,
  // контрактный для любой ручки со схемой входа
  if (input.hasInputSchema && !declared.some(sameCode(ValidationFailed))) {
    declared.push(ValidationFailed);
  }

  for (const definition of declared) {
    const code = String(httpCodeOf(definition.status));
    const schema = failSchema(definition, context);

    const group = byCode.get(code);
    if (group) {
      group.push(schema);
    } else {
      byCode.set(code, [schema]);
    }
  }

  for (const [code, schemas] of byCode) {
    // Успешный код занят успехом: отказ с тем же кодом невозможен —
    // словари статусов не пересекаются
    responses[code] = jsonResponse(
      describeFails(code, declared),
      schemas.length === 1 ? schemas[0] : { oneOf: schemas },
    );
  }

  responses.default = jsonResponse(
    `Undeclared failure, normalized by the boundary to '${UnknownError.code}'`,
    failSchema(UnknownError, context),
  );

  return responses;
}

/** Предикат «то же определение по коду» */
const sameCode =
  (definition: AnyFailDefinition) =>
  (other: AnyFailDefinition): boolean =>
    other.code === definition.code;

/**
 * Успешный ответ.
 *
 * Код — из `doc.status`; по умолчанию `OK`, а у ручки без `output` —
 * `NO_CONTENT`. Перевод статуса в код делает та же таблица, что и в бою
 * (`httpCodeOf` транспорта): второй копии таблицы у генератора нет.
 */
function planSuccess(
  input: ResponsesInput,
  context: ConvertContext,
): [string, OpenApiResponse] {
  const form = describeForm(input.output);
  const hasOutput = form.leaf !== undefined;

  const status = input.doc?.status ?? (hasOutput ? 'OK' : 'NO_CONTENT');
  const code = String(httpCodeOf(status));

  if (!hasOutput) {
    return [code, { description: 'Success' }];
  }

  const schema = convertLeaf(form.leaf, 'output', context, 'output');
  const mediaType = mediaTypeOf(input.output);

  // SSE: стандартного способа описать кадр в OpenAPI нет, поэтому схема
  // элемента уезжает в описание ответа — соврать `application/json`-схемой
  // было бы хуже
  if (form.kind === 'events') {
    return [
      code,
      {
        description:
          `Server-sent events. Each frame carries one item: ` +
          `${JSON.stringify(schema ?? null)}`,
        content: { [mediaType]: {} },
      },
    ];
  }

  return [
    code,
    {
      description:
        form.kind === 'stream'
          ? 'Success — a sequence of items, one per line'
          : 'Success',
      content:
        schema === undefined
          ? { [mediaType]: {} }
          : { [mediaType]: { schema } },
    },
  ];
}

/**
 * Тело отказа — то, что реально пишет граница.
 *
 * `code` описан константой: именно она отличает один отказ от другого,
 * и потребитель матчит по ней, а не по тексту.
 */
function failSchema(
  definition: AnyFailDefinition,
  context: ConvertContext,
): JsonValue {
  const properties: Record<string, JsonValue> = {
    error: { type: 'string' },
    code: { const: definition.code },
  };

  const details = convertLeaf(
    definition.schema,
    `errors['${definition.code}'].details`,
    context,
    'output',
  );

  if (details !== undefined) {
    properties.details = details;
  }

  return {
    type: 'object',
    properties,
    required: ['error', 'code'],
  };
}

/** Описание ответа: перечень кодов отказа, которые на нём живут */
function describeFails(
  code: string,
  declared: readonly AnyFailDefinition[],
): string {
  const codes = declared
    .filter((definition) => String(httpCodeOf(definition.status)) === code)
    .map((definition) => definition.code);

  return codes.length === 1
    ? `Failure '${codes[0]}'`
    : `Failure: one of ${codes.map((c) => `'${c}'`).join(', ')}`;
}

/** JSON-ответ с телом */
function jsonResponse(description: string, schema: JsonValue): OpenApiResponse {
  return {
    description,
    content: { 'application/json': { schema } },
  };
}
