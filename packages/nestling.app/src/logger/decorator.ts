/**
 * Декоратор полей корреляции: он ставит `requestId`, `traceId` и прочие
 * объявленные поля любой реализации логгера.
 *
 * Корень оборачивается им на фазе 0, до регистрации под `RootLogger$`,
 * поэтому поля получают и записи ядра, и записи узлов графа, и записи
 * логгера из опции `logging`. Сама реализация ячейку запроса не читает:
 * иначе каждая из них повторяла бы это чтение, а состав полей задавался бы
 * кодом сателлита, а не декларацией приложения.
 */

import { ambientValue } from '../pipeline/core/context/reader.js';

import type { ResolvedLogField } from './fields.js';

import type { Fields, Logger, LogLevel } from '@nestlingjs/logging';

/**
 * Список полей, который декоратор читает на каждой записи.
 *
 * Поле изменяемое: декоратор создаётся на фазе 0, а состав плагинов
 * известен только на BUILD. Записи фаз 0 и 1 идут вне запроса, и полей
 * корреляции у них не бывает, поэтому пустой список на них ничего не
 * меняет.
 *
 * @internal
 */
export interface LogFieldsPlan {
  fields: readonly ResolvedLogField[];
}

/** Первый аргумент метода уровня: одна из трёх форм вызова */
type FirstArgument = string | Error | Fields;

/** Метод уровня без перегрузок — то, чем декоратор зовёт обёрнутый логгер */
type Write = (first: FirstArgument, second?: Fields) => void;

/**
 * Логгер, который подмешивает поля корреляции и передаёт вызов дальше.
 *
 * Поля вызова ложатся поверх полей корреляции: явное значение
 * вызывающего важнее значения из контекста. Привязки `child` складывает
 * обёрнутая реализация — в конфликт с полями они не вступают.
 */
class FieldsLogger implements Logger {
  readonly #inner: Logger;
  readonly #plan: LogFieldsPlan;

  constructor(inner: Logger, plan: LogFieldsPlan) {
    this.#inner = inner;
    this.#plan = plan;
  }

  readonly debug = (first: FirstArgument, second?: Fields): void =>
    this.#write('debug', first, second);

  readonly info = (first: FirstArgument, second?: Fields): void =>
    this.#write('info', first, second);

  readonly warn = (first: FirstArgument, second?: Fields): void =>
    this.#write('warn', first, second);

  readonly error = (first: FirstArgument, second?: Fields): void =>
    this.#write('error', first, second);

  /** Дочерний логгер с теми же полями: привязки складывает реализация */
  child(bindings: Fields): Logger {
    return new FieldsLogger(this.#inner.child(bindings), this.#plan);
  }

  #write(level: LogLevel, first: FirstArgument, second?: Fields): void {
    const write = this.#inner[level] as Write;
    const correlation = this.#correlation();

    // Вне запроса и без объявленных полей вызов уходит как есть: лишнего
    // объекта на записи фаз 0 и 1 не создаётся
    if (correlation === undefined) {
      write(first, second);

      return;
    }

    if (typeof first === 'string' || first instanceof Error) {
      write(first, { ...correlation, ...second });

      return;
    }

    write({ ...correlation, ...first });
  }

  /** Значения объявленных переменных или `undefined`, если их нет */
  #correlation(): Fields | undefined {
    let out: Fields | undefined;

    for (const { key, name, select } of this.#plan.fields) {
      const value = ambientValue(key);

      if (value === undefined) {
        continue;
      }

      out ??= {};
      out[name] = select ? select(value) : value;
    }

    return out;
  }
}

/**
 * Оборачивает логгер декоратором полей корреляции.
 *
 * @param logger - Реализация: логгер из опции `logging` или штатный
 * @param plan - Список полей; заполняется на фазе BUILD
 * @returns Логгер, записи которого несут поля корреляции
 * @internal
 */
export const withLogFields = (logger: Logger, plan: LogFieldsPlan): Logger =>
  new FieldsLogger(logger, plan);
