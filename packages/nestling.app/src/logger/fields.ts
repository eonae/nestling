/**
 * Поля корреляции: объявление поля, сбор списка и проверка имён.
 *
 * Поле корреляции — это контекстная переменная, значение которой уходит в
 * каждую запись лога. Состав списка объявляют корень (`logging.fields`) и
 * плагины (`logFields`), а подмешивает значения декоратор корневого
 * логгера.
 */

import type { AnyContextVar } from '../pipeline/core/context/variable.js';
import { isContextVar } from '../pipeline/core/context/variable.js';
import { RequestId, Trace } from '../pipeline/core/context/well-known.js';

/**
 * Объявление поля корреляции: имя поля записи и проекция значения
 * переменной.
 *
 * Создаётся функцией {@link logField}; собирать словарь руками не нужно.
 *
 * @template T - Тип значения переменной
 */
export interface LogField<T = unknown> {
  /** Переменная, значение которой уходит в запись */
  readonly variable: AnyContextVar<T>;

  /** Имя поля записи */
  readonly name: string;

  /** Что из значения переменной попадает в поле; без неё — значение целиком */
  readonly select?: (value: T) => unknown;
}

/**
 * Элемент списка полей: переменная целиком или её объявление.
 *
 * Переменная без обёртки даёт поле с именем переменной и значением
 * целиком: `RequestId` — это `requestId: 'abc'`.
 *
 * Тип значения здесь стёрт: в одном списке стоят переменные разных типов,
 * а проекция принимает свой тип — сузить их до общего нечем.
 */
export type LogFieldSpec = AnyContextVar<any> | LogField<any>;

/**
 * Поле после сбора списка: ключ переменной, имя поля и проекция.
 *
 * Декоратор читает этот список на каждой записи, поэтому переменная здесь
 * уже сведена к ключу.
 *
 * @internal
 */
export interface ResolvedLogField {
  readonly key: string;
  readonly name: string;
  readonly select?: (value: unknown) => unknown;
}

/**
 * Объявляет поле корреляции с именем и, если нужно, проекцией значения.
 *
 * Проекция нужна переменным-объектам: `Trace` несёт `traceId`, `spanId` и
 * `sampled`, а в записи полезен идентификатор трассы — по нему ищут записи
 * двух процессов. Без проекции строка лога несла бы вложенный объект, и
 * поиск по `traceId=` перестал бы работать.
 *
 * Проекция вызывается на каждой записи и только тогда, когда значение
 * переменной есть.
 *
 * @param variable - Контекстная переменная
 * @param name - Имя поля записи
 * @param select - Что из значения переменной попадает в поле
 * @returns Объявление поля
 *
 * @example
 * ```typescript
 * logging: {
 *   fields: [RequestId, logField(Trace, 'traceId', (t) => t.traceId)],
 * }
 * ```
 *
 * @throws {TypeError} Первым аргументом передана не контекстная переменная
 * или имя пустое
 */
export function logField<T>(
  variable: AnyContextVar<T>,
  name: string,
  select?: (value: T) => unknown,
): LogField<T> {
  if (!isContextVar(variable)) {
    throw new TypeError(
      `logField(variable, name) expects a context variable value, not a key: ` +
        `declare it with contextVar<T>()('key') and pass the value.`,
    );
  }

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError(
      `logField(${variable.key}, name): 'name' must be a non-empty string — ` +
        `it is the name of the field in the log record.`,
    );
  }

  return Object.freeze({
    variable,
    name,
    ...(select !== undefined && { select }),
  });
}

/**
 * Умолчание списка полей: идентификатор запроса и идентификатор трассы.
 *
 * Те же два поля, что ядро ставило раньше. Трасса проецируется: в записи
 * полезен `traceId` — по нему ищут записи двух процессов, — а не объект
 * трассы целиком.
 */
export const DEFAULT_LOG_FIELDS: readonly LogFieldSpec[] = Object.freeze([
  RequestId,
  logField(Trace, 'traceId', (trace) => trace.traceId),
]);

/** Как сообщение об ошибке называет корень */
export const ROOT_FIELDS_OWNER = "the 'logging.fields' option of makeApp";

/** Объявление поля отличается от голой переменной наличием `variable` */
const isLogField = (spec: LogFieldSpec): spec is LogField =>
  typeof spec === 'object' && spec !== null && 'variable' in spec;

/** Список полей одного объявившего */
export interface LogFieldSource {
  /** Как назвать объявившего в сообщении об ошибке */
  readonly owner: string;

  /** Его список полей */
  readonly fields: readonly LogFieldSpec[];
}

/**
 * Сводит списки полей в один и проверяет имена.
 *
 * Два объявления с одним именем — отказ сборки: молча взять последнее
 * значило бы, что расхождение найдётся только в логе, когда поле уже
 * потеряно.
 *
 * @param sources - Списки корня и подключённых плагинов
 * @returns Поля в порядке объявления
 * @throws {Error} Два объявления с одним именем поля
 * @internal
 */
export function collectLogFields(
  sources: readonly LogFieldSource[],
): readonly ResolvedLogField[] {
  const byName = new Map<string, string>();
  const resolved: ResolvedLogField[] = [];

  for (const { owner, fields } of sources) {
    for (const spec of fields) {
      const field = normalize(owner, spec);
      const declared = byName.get(field.name);

      if (declared !== undefined) {
        throw new Error(
          `Two log fields are named '${field.name}': one is declared by ` +
            `${declared}, the other by ${owner}. A record has one field per ` +
            `name, so rename one of them with logField(<variable>, '<name>').`,
        );
      }

      byName.set(field.name, owner);
      resolved.push(field);
    }
  }

  return resolved;
}

/** Приводит элемент списка к паре «ключ переменной — имя поля» */
function normalize(owner: string, spec: LogFieldSpec): ResolvedLogField {
  if (isLogField(spec)) {
    return {
      key: spec.variable.key,
      name: spec.name,
      ...(spec.select !== undefined && {
        select: spec.select as (v: unknown) => unknown,
      }),
    };
  }

  if (!isContextVar(spec)) {
    throw new TypeError(
      `${owner} lists a log field that is neither a context variable nor a ` +
        `logField(…) declaration. Pass the variable value itself, or wrap it: ` +
        `logField(<variable>, '<name>').`,
    );
  }

  return { key: spec.key, name: spec.key };
}
