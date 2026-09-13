/**
 * `responses`: все ответы границы, а не только успешный.
 *
 * Множество ответов endpoint'а закрыто как `E ∪ InternalError` (модель
 * ошибок), и документ обязан это отражать: объявленные отказы,
 * автоматический `400` от проверки входа и `default` —
 * незадекларированное, приведённое границей к `internal_error`. Ответы
 * группируются по категории отказа: её транспорт переводит в HTTP-код.
 *
 * Тело отказа описывается **тем, что реально пишет транспорт**:
 * документом RFC 9457 под медиатипом `application/problem+json`.
 * Медиатип и построение члена `type` приходят из экспортов транспорта —
 * так документ описывает то, что уже уходит по сети, а не желаемое.
 */

import type { ConvertContext } from './schema.js';
import { convertLeaf } from './schema.js';
import type { JsonValue, OpenApiResponse } from './types.js';

import { describeForm, mediaTypeOf } from '@nestlingjs/app';
import type {
  AnyFailDefinition,
  DeclarationDoc,
  RedirectStatus,
} from '@nestlingjs/operations';
import { BadRequest, InternalError } from '@nestlingjs/operations';
import {
  httpCodeOf,
  PROBLEM_MEDIA_TYPE,
  problemTitleOf,
  problemTypeOf,
} from '@nestlingjs/transport.http';

/** Что генератор знает об ответах endpoint'а */
export interface ResponsesInput {
  readonly output: unknown;
  readonly errors?: readonly AnyFailDefinition[];
  readonly doc?: DeclarationDoc;

  /** Объявлена ли у endpoint'а схема входа: от неё зависит автоматический 400 */
  readonly hasInputSchema: boolean;

  /**
   * Объявленный статус редиректа (поле `redirect` декларации). Есть —
   * успешный ответ и есть редирект.
   */
  readonly redirect?: RedirectStatus;
}

/** Ответы операции по кодам ответа плюс `default` */
export type Responses = Record<string, OpenApiResponse>;

export function planResponses(
  input: ResponsesInput,
  context: ConvertContext,
): Responses {
  const responses: Responses = {};

  const [successCode, success] = planSuccess(input, context);
  responses[successCode] = success;

  // Отказы группируются по коду ответа: у двух определений с одной
  // категорией код совпадает, и второе не должно затирать первое
  const byCode = new Map<string, JsonValue[]>();

  const declared = [...(input.errors ?? [])];

  // Проверка входа отвечает независимо от `errors:` — это отказ ядра,
  // объявленный для любого endpoint'а со схемой входа
  if (input.hasInputSchema && !declared.some(sameCode(BadRequest))) {
    declared.push(BadRequest);
  }

  for (const definition of declared) {
    const code = String(httpCodeOf(definition.category));
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
    responses[code] = problemResponse(
      describeFails(code, declared),
      schemas.length === 1 ? schemas[0] : { oneOf: schemas },
    );
  }

  responses.default = problemResponse(
    `Undeclared failure, normalized by the boundary to '${InternalError.code}'`,
    failSchema(InternalError, context),
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
 * Код — из `doc.status`; по умолчанию `ok`, а у endpoint'а без `output` —
 * `no_content`. Перевод статуса в код делает та же таблица, что и в бою
 * (`httpCodeOf` транспорта): второй копии таблицы у генератора нет.
 *
 * Объявленный редирект и есть успешный исход: ответ несёт заголовок
 * `Location` и не несёт тела, а ответа по `doc.status` в операции нет.
 * Значение берётся с декларации: типы результата хендлера генератор не
 * видит.
 */
function planSuccess(
  input: ResponsesInput,
  context: ConvertContext,
): [string, OpenApiResponse] {
  if (input.redirect !== undefined) {
    return [
      String(input.redirect),
      {
        description: 'Redirect',
        headers: {
          Location: {
            description: 'Where the client is redirected to',
            schema: { type: 'string' },
          },
        },
      },
    ];
  }

  const form = describeForm(input.output);
  const hasOutput = form.leaf !== undefined;

  const status = input.doc?.status ?? (hasOutput ? 'ok' : 'no_content');
  const code = String(httpCodeOf(status));

  if (!hasOutput) {
    return [code, { description: 'Success' }];
  }

  const schema = convertLeaf(form.leaf, 'output', context, 'output');
  const mediaType = mediaTypeOf(input.output);

  // SSE: стандартного способа описать кадр в OpenAPI нет, поэтому схема
  // элемента попадает в описание ответа — соврать `application/json`-схемой
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
 * Тело отказа — документ RFC 9457, который реально пишет граница.
 *
 * `type` описан константой: именно она отличает один отказ от другого,
 * и потребитель матчит по ней, а не по тексту. `title` и `status`
 * константны по той же причине, по которой их пишет транспорт: они
 * выводятся из категории отказа.
 */
function failSchema(
  definition: AnyFailDefinition,
  context: ConvertContext,
): JsonValue {
  const properties: Record<string, JsonValue> = {
    type: { const: problemTypeOf(definition.code) },
    title: { const: problemTitleOf(definition.category) },
    status: { const: httpCodeOf(definition.category) },
    detail: { type: 'string' },
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
    required: ['type', 'title', 'status', 'detail'],
  };
}

/** Описание ответа: перечень кодов отказа, которые на нём живут */
function describeFails(
  code: string,
  declared: readonly AnyFailDefinition[],
): string {
  const codes = declared
    .filter((definition) => String(httpCodeOf(definition.category)) === code)
    .map((definition) => definition.code);

  return codes.length === 1
    ? `Failure '${codes[0]}'`
    : `Failure: one of ${codes.map((c) => `'${c}'`).join(', ')}`;
}

/** Ответ-отказ: документ RFC 9457 под своим медиатипом */
function problemResponse(
  description: string,
  schema: JsonValue,
): OpenApiResponse {
  return {
    description,
    content: { [PROBLEM_MEDIA_TYPE]: { schema } },
  };
}
