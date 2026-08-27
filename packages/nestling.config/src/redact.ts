/**
 * Редактирование секретных значений — одно правило на все поверхности.
 *
 * Поверхностей три: текст и объект `ConfigValidationError` (здесь —
 * {@link toFieldFailure}), печать проекции (здесь — {@link defineDisplayHooks})
 * и снимок реестра (там значений нет и не было). Правило одно и живёт в
 * одном месте: вторая копия разъехалась бы с первой ровно на том случае,
 * ради которого всё делается.
 *
 * Граница гарантии названа явно: `{ ...cfg }`, `Object.values(cfg)` и прямое
 * чтение поля отдают настоящее значение. Это цена решения «для потребителя
 * значение остаётся обычным»; закрыть её мог бы только брендированный
 * `Secret<T>`, отвергнутый журналом.
 */

import type { SectionField } from './declaration.js';
import type { ConfigFieldFailure } from './errors.js';
import { REDACTED } from './errors.js';
import { isSecretKey } from './registry.js';

import type { SchemaIssue } from '@common/misc';

/** Чем заменяется значение секретного поля при печати проекции */
export const SECRET_MASK = '***';

/** Хук `util.inspect`, взятый `Symbol.for`, чтобы не импортировать `node:util` */
const INSPECT = Symbol.for('nodejs.util.inspect.custom');

/**
 * Складывает отказ поля, редактируя сообщения issue'ев секретного ключа.
 *
 * Вендорский текст не покидает вызов валидации: в объект отказа попадают
 * **уже** отредактированные issue'ы, а не редактируются при рендере.
 *
 * Редактирование взводится только если значение было задано: не заданный
 * ключ — самая частая ошибка с секретами, утечки в её сообщении нет по
 * определению, а «expected string, received undefined» — главный сценарий
 * отладки.
 */
export const toFieldFailure = (
  field: SectionField,
  rawValue: unknown,
  issues: readonly SchemaIssue[],
): ConfigFieldFailure => {
  const redacted = rawValue !== undefined && isSecretKey(field.key);

  return {
    field: field.name,
    key: field.key,
    redacted,
    issues: redacted
      ? issues.map((issue) => ({ ...issue, message: REDACTED }))
      : issues,
  };
};

/**
 * Имена полей секции, секретных **эффективно** — с учётом всех читателей
 * ключа, а не только объявления этой секции.
 */
export const secretFieldsOf = (
  fields: readonly SectionField[],
): readonly string[] =>
  fields.filter((field) => isSecretKey(field.key)).map((field) => field.name);

/**
 * Ставит на проекцию `toJSON()` и `inspect.custom`, отдающие копию значений
 * с {@link SECRET_MASK} вместо секретных полей.
 *
 * Оба члена неперечислимы, поэтому `Object.keys` и форма объекта не меняются.
 * Секция без секретных полей не получает их вовсе — её наблюдаемое поведение
 * остаётся ровно прежним.
 *
 * @param target - Проекция, на которую ставятся хуки
 * @param secretNames - Имена секретных полей ({@link secretFieldsOf})
 * @param snapshot - Актуальные значения; у reloadable-секции это живой снапшот
 */
export const defineDisplayHooks = (
  target: object,
  secretNames: readonly string[],
  snapshot: () => Record<string, unknown>,
): void => {
  if (secretNames.length === 0) {
    return;
  }

  const redactedCopy = (): Record<string, unknown> => {
    const copy = { ...snapshot() };

    for (const name of secretNames) {
      copy[name] = SECRET_MASK;
    }

    return copy;
  };

  Object.defineProperty(target, 'toJSON', { value: redactedCopy });
  Object.defineProperty(target, INSPECT, { value: redactedCopy });
};
