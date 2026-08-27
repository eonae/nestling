import { defineFail } from './define-fail.js';
import { jsonSchema } from './json-schema.js';

import type { SchemaIssue, StandardSchemaV1 } from '@common/misc';

/**
 * Схема деталей отказа валидации — **написана руками**.
 *
 * Standard Schema это интерфейс, а не библиотека: ядру не нужен вендор,
 * чтобы объявить схему. Так `ValidationFailed` остаётся schema-first
 * наравне с пользовательскими определениями, а `@nestling/pipeline` —
 * без зависимости от валидатора.
 *
 * Вендор `nestling` не понимает ни один конвертер — и не должен: схемы
 * ядра объявляют свою JSON Schema аннотацией. Без неё генератор
 * документации требовал бы от пользователя конвертер для схемы, которую
 * тот не писал.
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

/** Форма провода `issues` — она же контракт спеки Standard Schema */
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
 * Незадекларированный отказ, приведённый границей к контракту.
 *
 * В множество допустимых ответов входит **неявно**, без объявления в
 * `errors:` — это тот самый ответ, которым страж закрывает всё, что не
 * задекларировано.
 */
export const UnknownError = defineFail('UNKNOWN', {
  status: 'INTERNAL_ERROR',
  message: 'Internal server error',
});

/**
 * Отказ валидации входа.
 *
 * Тоже kernel-код: иначе штатный 400 от `validate()`-юнита страж
 * превращал бы в 500 — прямое противоречие модели входных ошибок.
 */
export const ValidationFailed = defineFail('VALIDATION_FAILED', {
  status: 'BAD_REQUEST',
  message: 'Validation failed',
  details: issuesSchema,
});

/**
 * Схема деталей отказа лимита — тоже написана руками и тоже аннотирована
 * (см. `issuesSchema`).
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
 * Kernel-код по той же причине, что и `ValidationFailed`: штатный 413 не
 * должен превращаться стражем границы в 500 `UNKNOWN`.
 */
export const StreamLimitExceeded = defineFail('STREAM_LIMIT_EXCEEDED', {
  status: 'PAYLOAD_TOO_LARGE',
  details: numberFieldSchema('max'),
  message: (d) => `Stream limit of ${d.max} item(s) exceeded`,
});

/** Отказ таймаута молчания источника (`.gapTimeout(ms)`) */
export const StreamGapTimeout = defineFail('STREAM_GAP_TIMEOUT', {
  status: 'TIMEOUT',
  details: numberFieldSchema('ms'),
  message: (d) => `Stream produced no item within ${d.ms}ms`,
});

/**
 * Отказ исчерпанного бюджета вызова (`meta.deadline` портов).
 *
 * Kernel-код по той же причине, что и соседи: бюджет — механизм ядра, и
 * его штатный 504 не должен превращаться стражем границы в 500 `UNKNOWN`.
 * Определение живёт здесь, а не в `@nestling/ports`, потому что здесь
 * живёт закрытый набор: регистрация кода из чужого пакета означала бы
 * рантайм-мутацию множества, которое обещано закрытым.
 *
 * Имя без суффикса `Error` — как у `ValidationFailed` и потоковых отказов;
 * `UnknownError` в этом ряду исключение, а не правило.
 */
export const DeadlineExceeded = defineFail('DEADLINE_EXCEEDED', {
  status: 'TIMEOUT',
  message: 'Call deadline exceeded',
});

/**
 * Закрытый набор встроенных кодов.
 *
 * Растёт только вместе с ядром — вместе с механизмами, которые эти отказы
 * порождают (валидация, лимиты item-цепочек, бюджет вызова портов);
 * публичного способа пометить пользовательский код встроенным нет — иначе
 * закрытость множества ответов снова стала бы конвенцией.
 */
const KERNEL_FAIL_CODES: ReadonlySet<string> = new Set([
  UnknownError.code,
  ValidationFailed.code,
  StreamLimitExceeded.code,
  StreamGapTimeout.code,
  DeadlineExceeded.code,
]);

/**
 * Входит ли код в kernel-набор.
 *
 * Читается стражем границы: kernel-коды контрактны для любой ручки.
 */
export function isKernelFailCode(code: string | undefined): boolean {
  return code !== undefined && KERNEL_FAIL_CODES.has(code);
}
