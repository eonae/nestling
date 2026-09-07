/**
 * Минимальные Standard-Schema-значения — **не библиотека схем**.
 *
 * Standard Schema это интерфейс, а не вендор: чтобы объявить секцию из
 * шести полей и два плоских факта, пакету не нужен ни zod, ни valibot — и
 * приложение не обязано выбирать того же вендора, что автор пакета. Тот
 * же приём, что у kernel-секции портов.
 *
 * Здесь ровно столько, сколько нужно объявлениям пакета: целые числа с
 * умолчанием, флаг, строки и числа рекорда. За объединениями и
 * вложенностью идут к настоящему вендору.
 */

import type { StandardSchemaV1 } from '@common/misc';
import { jsonSchema } from '@nestling/operations';

/** Один отказ схемы — форма, которую ждёт Standard Schema */
const issue = (message: string): { issues: [{ message: string }] } => ({
  issues: [{ message }],
});

/** Значение отсутствует: источник не задал ключ или задал пустую строку */
const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || value === '';

/**
 * Целое число с умолчанием и нижней границей.
 *
 * Строка приводится к числу: значения из окружения приходят строками.
 *
 * @param fallback - Значение, когда ключ не задан
 * @param min - Нижняя граница включительно
 */
export const int = (
  fallback: number,
  min: number,
): StandardSchemaV1<unknown, number> => ({
  '~standard': {
    version: 1,
    vendor: 'nestling',
    validate: (value) => {
      if (isBlank(value)) {
        return { value: fallback };
      }

      const parsed = typeof value === 'number' ? value : Number(value);

      if (!Number.isInteger(parsed)) {
        return issue(`Expected an integer, got ${JSON.stringify(value)}`);
      }

      return parsed < min
        ? issue(`Expected an integer >= ${min}, got ${parsed}`)
        : { value: parsed };
    },
  },
});

/** Значения, которые считаются булевыми в источнике конфигурации */
const TRUE = new Set(['true', '1', 'yes', 'on']);
const FALSE = new Set(['false', '0', 'no', 'off']);

/**
 * Флаг с умолчанием.
 *
 * Принимает и булево значение, и его строковую запись: источником может
 * быть и объект в тесте, и переменная окружения.
 */
export const flag = (
  fallback: boolean,
): StandardSchemaV1<unknown, boolean> => ({
  '~standard': {
    version: 1,
    vendor: 'nestling',
    validate: (value) => {
      if (isBlank(value)) {
        return { value: fallback };
      }

      if (typeof value === 'boolean') {
        return { value };
      }

      const text = String(value).toLowerCase();

      if (TRUE.has(text)) {
        return { value: true };
      }

      return FALSE.has(text)
        ? { value: false }
        : issue(
            `Expected one of 'true', 'false', '1', '0', 'yes', 'no', 'on', ` +
              `'off', got ${JSON.stringify(value)}`,
          );
    },
  },
});

/** Тип листа рекорда: ровно то, что встречается в фактах пакета */
type FieldType = 'string' | 'number';

/** Описание одного поля рекорда */
interface FieldSpec {
  readonly type: FieldType;

  /** Поле может отсутствовать (`undefined` тоже считается отсутствием) */
  readonly optional?: boolean;
}

/** Обязательная строка */
export const str = (): FieldSpec => ({ type: 'string' });

/** Необязательная строка */
export const optionalStr = (): FieldSpec => ({
  type: 'string',
  optional: true,
});

/** Обязательное число */
export const num = (): FieldSpec => ({ type: 'number' });

/** Проверяет одно поле; возвращает текст проблемы или `undefined` */
function checkField(spec: FieldSpec, value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return spec.optional ? undefined : 'Expected a value, got nothing';
  }

  return typeof value === spec.type
    ? undefined
    : `Expected ${spec.type}, got ${typeof value}`;
}

/**
 * Рекорд плоских полей как Standard Schema.
 *
 * Приём строгий: наружу передаются только объявленные поля, неизвестные
 * отбрасываются. Значение аннотируется `jsonSchema(...)`, потому что
 * вендора `nestling` не понимает ни один конвертер, и без аннотации факт
 * попадал бы в документацию непрозрачным листом.
 *
 * @param T - Проекция рекорда; объявляется рядом с самим рекордом
 */
export function record<T>(
  fields: Readonly<Record<string, FieldSpec>>,
): StandardSchemaV1<unknown, T> {
  const base: StandardSchemaV1<unknown, T> = {
    '~standard': {
      version: 1,
      vendor: 'nestling',
      validate: (value) => {
        if (typeof value !== 'object' || value === null) {
          return issue(`Expected an object, got ${typeof value}`);
        }

        const source = value as Record<string, unknown>;
        const issues: { message: string; path: [string] }[] = [];
        const parsed: Record<string, unknown> = {};

        for (const [key, spec] of Object.entries(fields)) {
          const problem = checkField(spec, source[key]);

          if (problem) {
            issues.push({ message: problem, path: [key] });
            continue;
          }

          if (source[key] !== undefined && source[key] !== null) {
            parsed[key] = source[key];
          }
        }

        return issues.length > 0 ? { issues } : { value: parsed as T };
      },
    },
  };

  const entries = Object.entries(fields);

  return jsonSchema(base, {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      entries.map(([key, spec]) => [key, { type: spec.type }]),
    ),
    required: entries.filter(([, spec]) => !spec.optional).map(([key]) => key),
  });
}
