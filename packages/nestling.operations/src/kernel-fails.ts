import { jsonSchema } from './json-schema.js';
import { makeFail } from './make-fail.js';

import type { SchemaIssue, StandardSchemaV1 } from '@common/misc';

/**
 * Схема деталей отказа проверки входа, написанная вручную.
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
 * Отказы ядра. Каждый несёт голую категорию без уточнения и входит в
 * множество ответов любого endpoint'а без объявления в `errors`.
 *
 * Набор закрыт и растёт только вместе с механизмами ядра, которые эти
 * отказы порождают. Пользовательское определение с тем же кодом
 * (`makeFail('bad_request')`) — тот же отказ по идентичности.
 */

/**
 * Отказ проверки входа: значение не прошло схему `input`, поля
 * `multipart` не прошли схему `fields`, разбор запроса не удался.
 * Детали — `issues` в формате Standard Schema.
 */
export const BadRequest = makeFail('bad_request', {
  message: 'Bad request',
  details: issuesSchema,
});

/**
 * Отказ превышения лимита входа: тело, строка потока, файл или число
 * элементов item-цепочки (`.limit(n)`) больше допустимого.
 *
 * У потокового входа лимит срабатывает во время чтения, то есть уже
 * внутри хендлера, и без кода ядра 413 превращался бы на границе в 500.
 */
export const PayloadTooLarge = makeFail('payload_too_large', {
  details: numberFieldSchema('limit'),
  message: (d) => `Payload exceeds the limit of ${d.limit}`,
});

/**
 * Отказ по истечении срока: бюджет вызова порта (`meta.deadline`) или
 * молчание потока дольше `.gapTimeout(ms)`.
 *
 * Объявлен здесь, а не в `@nestling/ports`: набор кодов ядра закрыт и не
 * пополняется из других пакетов. `@nestling/ports` его реэкспортирует.
 */
export const Timeout = makeFail('timeout', {
  message: 'Operation timed out',
});

/**
 * Отказ, которым заменяется любой незадекларированный отказ и любая
 * необработанная ошибка на выходе из пайплайна.
 */
export const InternalError = makeFail('internal_error', {
  message: 'Internal server error',
});

/**
 * Закрытый набор кодов ядра. Публичного способа добавить в него
 * пользовательский код нет.
 */
const KERNEL_FAIL_CODES: ReadonlySet<string> = new Set([
  BadRequest.code,
  PayloadTooLarge.code,
  Timeout.code,
  InternalError.code,
]);

/**
 * Входит ли код в kernel-набор.
 *
 * Коды ядра считаются объявленными у любого endpoint'а.
 */
export function isKernelFailCode(code: string | undefined): boolean {
  return code !== undefined && KERNEL_FAIL_CODES.has(code);
}
