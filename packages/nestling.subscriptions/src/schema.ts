/**
 * Минимальный конструктор Standard-Schema-рекорда — **не библиотека схем**.
 *
 * Standard Schema это интерфейс, а не вендор: чтобы объявить два плоских
 * факта, satellite'у не нужен ни zod, ни valibot — и приложение, которое
 * его подключает, не обязано выбирать тот же вендор, что автор пакета. Тот
 * же приём, что у kernel-секции портов (`packages/nestling.ports/src/config.ts`).
 *
 * Здесь ровно столько, сколько нужно двум объявлениям
 * (`subscriptions.opened`/`subscriptions.closed`): строки, числа,
 * опциональность и перечисление строк. Ни объединений, ни вложенности, ни
 * трансформаций — за ними идут к настоящему вендору.
 */

import type { StandardSchemaV1 } from '@common/misc';

/** Тип листа: ровно то, что встречается в фактах пакета */
type FieldType = 'string' | 'number';

/** Описание одного поля рекорда */
interface FieldSpec {
  readonly type: FieldType;

  /** Поле может отсутствовать (`undefined` тоже считается отсутствием) */
  readonly optional?: boolean;

  /** Допустимые значения строкового поля — перечисление */
  readonly values?: readonly string[];
}

/** Обязательная строка; с перечислением — строковый enum */
export const str = (values?: readonly string[]): FieldSpec => ({
  type: 'string',
  values,
});

/** Необязательная строка (в том числе перечисление) */
export const optionalStr = (values?: readonly string[]): FieldSpec => ({
  type: 'string',
  optional: true,
  values,
});

/** Обязательное число */
export const num = (): FieldSpec => ({ type: 'number' });

/** Проверяет одно поле; возвращает текст проблемы или `undefined` */
function checkField(spec: FieldSpec, value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return spec.optional ? undefined : 'Expected a value, got nothing';
  }

  if (typeof value !== spec.type) {
    return `Expected ${spec.type}, got ${typeof value}`;
  }

  if (spec.values && !spec.values.includes(value as string)) {
    const allowed = spec.values.map((one) => `'${one}'`).join(', ');

    return `Expected one of ${allowed}, got ${JSON.stringify(value)}`;
  }

  return undefined;
}

/**
 * Рекорд плоских полей как Standard Schema.
 *
 * Приём строгий: наружу уезжают только объявленные поля, а неизвестные
 * отбрасываются — факт не должен возить с собой то, чего нет в его
 * описании.
 *
 * @param T - Проекция рекорда; объявляется рядом с самим рекордом, потому
 * что вывода типа из значения тут не будет — вендор не подключён
 */
export function record<T>(
  fields: Readonly<Record<string, FieldSpec>>,
): StandardSchemaV1<unknown, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'nestling',
      validate: (value) => {
        if (typeof value !== 'object' || value === null) {
          return {
            issues: [{ message: `Expected an object, got ${typeof value}` }],
          };
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
}
