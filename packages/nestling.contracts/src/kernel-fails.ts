import { defineFail } from './define-fail.js';
import { jsonSchema } from './json-schema.js';

import type { SchemaIssue, StandardSchemaV1 } from '@common/misc';

/**
 * Схема деталей отказа валидации, написанная вручную.
 *
 * Standard Schema — интерфейс, поэтому ядро объявляет схему без
 * библиотеки-валидатора. Конвертеры документации вендор `nestling` не
 * знают, поэтому JSON Schema для схем ядра объявлена аннотацией
 * `jsonSchema`.
 */
const rawIssuesSchema: StandardSchemaV1<unknown, readonly SchemaIssue[]> = {
  '~standard': {
    version: 1,
    vendor: 'nestling',
    validate: (value) => {
      if (!Array.isArray(value)) {
        return { issues: [{ message: 'Expected an array of schema issues' }] };
      }

      const issues = value.map((item, index) => {
        const message = (item as { message?: unknown })?.message;
        return typeof message === 'string'
          ? undefined
          : { message: 'Expected `message` to be a string', path: [index] };
      });

      const bad = issues.filter((issue) => issue !== undefined);
      return bad.length > 0
        ? { issues: bad }
        : { value: value as readonly SchemaIssue[] };
    },
  },
};

/** JSON Schema для `issues`; повторяет формат из спецификации Standard Schema */
const issuesSchema = jsonSchema(rawIssuesSchema, {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      path: {
        type: 'array',
        items: { type: ['string', 'number'] },
      },
    },
    required: ['message'],
  },
});

/**
 * Отказ, которым заменяется любой незадекларированный отказ на выходе из
 * пайплайна. Входит в множество ответов каждого endpoint'а без объявления
 * в `errors`.
 */
export const UnknownError = defineFail('UNKNOWN', {
  status: 'INTERNAL_ERROR',
  message: 'Internal server error',
});

/**
 * Отказ валидации входа.
 *
 * Код ядра: иначе 400 от юнита `validate()` превращался бы на выходе из
 * пайплайна в 500 `UnknownError`.
 */
export const ValidationFailed = defineFail('VALIDATION_FAILED', {
  status: 'BAD_REQUEST',
  message: 'Validation failed',
  details: issuesSchema,
});

/**
 * Схема объекта с одним числовым полем; написана вручную и аннотирована,
 * как `issuesSchema`.
 */
function numberFieldSchema<K extends string>(
  field: K,
): StandardSchemaV1<unknown, Record<K, number>> {
  const schema: StandardSchemaV1<unknown, Record<K, number>> = {
    '~standard': {
      version: 1,
      vendor: 'nestling',
      validate: (value) => {
        const candidate = (value as Record<string, unknown> | undefined)?.[
          field
        ];
        return typeof candidate === 'number'
          ? { value: { [field]: candidate } as Record<K, number> }
          : {
              issues: [{ message: `Expected \`${field}\` to be a number` }],
            };
      },
    },
  };

  return jsonSchema(schema, {
    type: 'object',
    properties: { [field]: { type: 'number' } },
    required: [field],
  });
}

/**
 * Отказ лимита item-цепочки (`.limit(max)`).
 *
 * Код ядра по той же причине, что и `ValidationFailed`: 413 не должен
 * превращаться в 500.
 */
export const StreamLimitExceeded = defineFail('STREAM_LIMIT_EXCEEDED', {
  status: 'PAYLOAD_TOO_LARGE',
  details: numberFieldSchema('max'),
  message: (d) => `Stream limit of ${d.max} item(s) exceeded`,
});

/**
 * Отказ превышения лимита размера входа.
 *
 * Его бросает транспорт, когда тело или одна строка потока не помещаются
 * в лимит. Код ядра по той же причине, что и у соседей: у потокового
 * входа лимит срабатывает во время чтения, то есть уже внутри хендлера,
 * и без кода ядра 413 превращался бы на границе в 500.
 */
export const PayloadTooLarge = defineFail('PAYLOAD_TOO_LARGE', {
  status: 'PAYLOAD_TOO_LARGE',
  details: numberFieldSchema('limit'),
  message: (d) => `Payload exceeds the limit of ${d.limit} byte(s)`,
});

/** Отказ таймаута молчания источника (`.gapTimeout(ms)`) */
export const StreamGapTimeout = defineFail('STREAM_GAP_TIMEOUT', {
  status: 'TIMEOUT',
  details: numberFieldSchema('ms'),
  message: (d) => `Stream produced no item within ${d.ms}ms`,
});

/**
 * Отказ по истечении срока вызова (`meta.deadline` портов).
 *
 * Код ядра по той же причине, что и соседние: 504 не должен превращаться
 * в 500. Объявлен здесь, а не в `@nestling/ports`, потому что набор кодов
 * ядра закрыт и не пополняется из других пакетов.
 */
export const DeadlineExceeded = defineFail('DEADLINE_EXCEEDED', {
  status: 'TIMEOUT',
  message: 'Call deadline exceeded',
});

/**
 * Закрытый набор кодов ядра. Публичного способа добавить в него
 * пользовательский код нет.
 */
const KERNEL_FAIL_CODES: ReadonlySet<string> = new Set([
  UnknownError.code,
  ValidationFailed.code,
  PayloadTooLarge.code,
  StreamLimitExceeded.code,
  StreamGapTimeout.code,
  DeadlineExceeded.code,
]);

/**
 * Входит ли код в kernel-набор.
 *
 * Коды ядра считаются объявленными у любого endpoint'а.
 */
export function isKernelFailCode(code: string | undefined): boolean {
  return code !== undefined && KERNEL_FAIL_CODES.has(code);
}
