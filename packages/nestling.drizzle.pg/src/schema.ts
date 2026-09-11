/**
 * Минимальные Standard-Schema-значения — **не библиотека схем**.
 *
 * Standard Schema это интерфейс, а не вендор: чтобы объявить секцию из
 * шести полей, пакету не нужен ни zod, ни valibot — и приложение не
 * обязано выбирать того же вендора, что автор пакета. Тот же приём, что
 * у `@nestlingjs/outbox` и у kernel-секции портов.
 *
 * Здесь ровно столько, сколько нужно секции соединения: обязательная
 * строка, целое число с умолчанием и нижней границей, флаг.
 */

import type { StandardSchemaV1 } from '@nestlingjs/common.misc';

/** Один отказ схемы — форма, которую ждёт Standard Schema */
const issue = (message: string): { issues: [{ message: string }] } => ({
  issues: [{ message }],
});

/** Значение отсутствует: источник не задал ключ или задал пустую строку */
const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || value === '';

/**
 * Обязательная непустая строка.
 *
 * Умолчания нет: адрес базы придумать за приложение нельзя, и пустой
 * ключ обязан останавливать старт.
 */
export const str = (): StandardSchemaV1<unknown, string> => ({
  '~standard': {
    version: 1,
    vendor: 'nestling',
    validate: (value) =>
      isBlank(value)
        ? issue('Expected a non-empty string, got nothing')
        : { value: String(value) },
  },
});

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
