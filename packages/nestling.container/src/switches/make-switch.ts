/**
 * `makeSwitch` — конструктор переключателя состава.
 *
 * Создание переключателя не имеет побочных эффектов: глобального реестра
 * переключателей нет, словарь приложения объявляет корень полем
 * `switches:`.
 */

import type {
  AnySwitch,
  Switch,
  SwitchBranch,
  Toggle,
  ToggleSwitch,
} from './types.js';
import { BRANCH } from './types.js';

import type { StandardSchemaV1 } from '@standard-schema/spec';

/** Значения двухпозиционного переключателя в порядке объявления */
const TOGGLE_VALUES: readonly Toggle[] = ['on', 'off'];

/** Словарь умолчания: третий аргумент конструктора */
export interface SwitchOptions<Default extends string> {
  /** Значение, которым переключатель считается, если его не передали */
  readonly default: Default;
}

/**
 * Текст отказа на значении вне словаря — один на схему и на сборку.
 *
 * @param name - Имя переключателя
 * @param values - Допустимые значения
 * @param given - Полученное значение
 */
export const unknownValueMessage = (
  name: string,
  values: readonly string[],
  given: unknown,
): string =>
  `Switch '${name}' has no value ${JSON.stringify(given)}. ` +
  `Allowed values: ${values.map((value) => `'${value}'`).join(', ')}.`;

/** Строит Standard Schema значений переключателя с умолчанием */
function makeSchema<Values extends string>(
  name: string,
  values: readonly Values[],
  fallback: Values | undefined,
): StandardSchemaV1<string, Values> {
  return {
    '~standard': {
      version: 1,
      vendor: 'nestling',
      validate: (value: unknown) => {
        if (value === undefined && fallback !== undefined) {
          return { value: fallback };
        }

        if (
          typeof value === 'string' &&
          (values as readonly string[]).includes(value)
        ) {
          return { value: value as Values };
        }

        return {
          issues: [{ message: unknownValueMessage(name, values, value) }],
        };
      },
    },
  };
}

/** Приводит ветку таблицы к списку: одно значение, массив или пустой массив */
const toBranchItems = <T>(branch: T | readonly T[]): readonly T[] =>
  Array.isArray(branch) ? (branch as readonly T[]) : ([branch] as readonly T[]);

/** Проверяет имя, словарь значений и умолчание при создании */
function assertDeclaration(
  name: string,
  values: readonly string[],
  fallback: string | undefined,
): void {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError(
      `makeSwitch(name, …): 'name' must be a non-empty string — it names the ` +
        `field of the assembly argument.`,
    );
  }

  if (values.length < 2 || new Set(values).size !== values.length) {
    throw new Error(
      `makeSwitch('${name}', […]): a switch needs at least two distinct ` +
        `values, got ${JSON.stringify(values)}. A single-valued switch ` +
        `chooses nothing — drop it and declare the composition directly.`,
    );
  }

  if (fallback !== undefined && !values.includes(fallback)) {
    throw new Error(
      `makeSwitch('${name}', …, { default: ${JSON.stringify(fallback)} }): ` +
        `the default is not one of the switch values. ` +
        `Allowed values: ${values.map((value) => `'${value}'`).join(', ')}.`,
    );
  }
}

/**
 * Объявляет переключатель состава.
 *
 * Четыре формы: двухпозиционный (`'on' | 'off'`) с умолчанием и без,
 * перечисление с умолчанием и без. Имя переключателя становится полем
 * аргумента сборки; поле обязательно, пока у переключателя нет умолчания.
 *
 * @param name - Имя переключателя
 * @param values - Словарь значений; без него значения — `'on'` и `'off'`
 * @param options - Умолчание
 * @returns Значение-переключатель с методами `pick` (и `when` у
 * двухпозиционного)
 * @throws {TypeError} Пустое имя
 * @throws {Error} Меньше двух различных значений или умолчание вне словаря
 *
 * @example
 * ```typescript
 * export const Storage = makeSwitch('storage', ['s3', 'local']);
 * export const Metrics = makeSwitch('metrics');
 * export const Debug = makeSwitch('debug', { default: 'off' });
 *
 * providers: [Storage.pick({ s3: [S3Storage], local: [LocalStorage] })];
 * providers: [Metrics.when(StorageMetrics)];
 * ```
 */
export function makeSwitch<const Name extends string>(
  name: Name,
): ToggleSwitch<Name, undefined>;
export function makeSwitch<
  const Name extends string,
  const Default extends Toggle,
>(name: Name, options: SwitchOptions<Default>): ToggleSwitch<Name, Default>;
export function makeSwitch<
  const Name extends string,
  const Values extends string,
>(name: Name, values: readonly Values[]): Switch<Name, Values, undefined>;
export function makeSwitch<
  const Name extends string,
  const Values extends string,
  const Default extends Values,
>(
  name: Name,
  values: readonly Values[],
  options: SwitchOptions<Default>,
): Switch<Name, Values, Default>;
export function makeSwitch(
  name: string,
  valuesOrOptions?: readonly string[] | SwitchOptions<string>,
  maybeOptions?: SwitchOptions<string>,
): AnySwitch {
  const toggle = !Array.isArray(valuesOrOptions);

  const values = toggle
    ? (TOGGLE_VALUES as readonly string[])
    : (valuesOrOptions as readonly string[]);

  const options = toggle
    ? (valuesOrOptions as SwitchOptions<string> | undefined)
    : maybeOptions;

  const fallback = options?.default;

  assertDeclaration(name, values, fallback);

  const declared: AnySwitch = {
    name,
    values: Object.freeze([...values]),
    default: fallback,
    schema: makeSchema(name, values, fallback),

    pick(table: Record<string, unknown>): SwitchBranch<any> {
      const branches: Record<string, readonly unknown[]> = {};

      for (const value of values) {
        branches[value] = Object.freeze([...toBranchItems(table[value])]);
      }

      return makeBranch(declared, Object.freeze(branches));
    },
  };

  if (toggle) {
    (declared as ToggleSwitch).when = (items: unknown): SwitchBranch<any> =>
      declared.pick({ on: items, off: [] });
  }

  return Object.freeze(declared);
}

/** Собирает значение-ветку: бренд неперечислим, таблица заморожена */
function makeBranch<T>(
  declared: AnySwitch,
  table: Readonly<Record<string, readonly T[]>>,
): SwitchBranch<T> {
  const branch = {} as { [BRANCH]: { switch: AnySwitch; table: typeof table } };

  Object.defineProperty(branch, BRANCH, {
    value: Object.freeze({ switch: declared, table }),
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return Object.freeze(branch) as SwitchBranch<T>;
}

/**
 * Проверяет, что значение — переключатель, созданный `makeSwitch`.
 *
 * @param value - Проверяемое значение
 * @returns `true`, если это переключатель
 */
export const isSwitch = (value: unknown): value is AnySwitch =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as AnySwitch).name === 'string' &&
  Array.isArray((value as AnySwitch).values) &&
  typeof (value as AnySwitch).pick === 'function';

/**
 * Проверяет, что значение — ветка переключателя.
 *
 * @param value - Проверяемое значение
 * @returns `true`, если это ветка
 */
export const isSwitchBranch = (
  value: unknown,
): value is SwitchBranch<unknown> =>
  typeof value === 'object' && value !== null && BRANCH in value;
