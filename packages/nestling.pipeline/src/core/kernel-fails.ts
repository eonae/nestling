import type { SchemaIssue } from '../schema/errors.js';

import { defineFail } from './define-fail.js';

import type { StandardSchemaV1 } from '@common/misc';

/**
 * Схема деталей отказа валидации — **написана руками**.
 *
 * Standard Schema это интерфейс, а не библиотека: ядру не нужен вендор,
 * чтобы объявить схему. Так `ValidationFailed` остаётся schema-first
 * наравне с пользовательскими определениями, а `@nestling/pipeline` —
 * без зависимости от валидатора.
 */
const issuesSchema: StandardSchemaV1<unknown, readonly SchemaIssue[]> = {
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
 * Закрытый набор встроенных кодов.
 *
 * Растёт только вместе с ядром (у портов сюда добавится
 * `DEADLINE_EXCEEDED`); публичного способа пометить пользовательский код
 * встроенным нет — иначе закрытость множества ответов снова стала бы
 * конвенцией.
 */
const KERNEL_FAIL_CODES: ReadonlySet<string> = new Set([
  UnknownError.code,
  ValidationFailed.code,
]);

/**
 * Входит ли код в kernel-набор.
 *
 * Читается стражем границы: kernel-коды контрактны для любой ручки.
 */
export function isKernelFailCode(code: string | undefined): boolean {
  return code !== undefined && KERNEL_FAIL_CODES.has(code);
}
