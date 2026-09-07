/**
 * Типы переключателя состава и его ветки.
 *
 * Ветка — **значение** с брендом, а не функция: состав каждой ветки
 * читается без выполнения кода, поэтому и `check()`, и человек видят обе
 * ветки сразу.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';

/** Значения двухпозиционного переключателя */
export type Toggle = 'on' | 'off';

/**
 * Бренд ветки: неперечислимое symbol-свойство.
 *
 * По нему раскрытие отличает ветку от обычного элемента списка. Ключ взят
 * из глобального реестра символов: бренд переживает две копии пакета в
 * одном процессе.
 */
export const BRANCH: unique symbol = Symbol.for('nestling:switch-branch');

/** Содержимое ветки: её переключатель и таблица значений */
export interface BranchMeta<T> {
  /** Переключатель, чьё значение выбирает элементы */
  readonly switch: AnySwitch;

  /** Значение переключателя → элементы этой ветки */
  readonly table: Readonly<Record<string, readonly T[]>>;
}

/**
 * Ветка состава: элементы, которые попадают в список при одном из значений
 * переключателя.
 *
 * Раскрывается в ноль и больше элементов того же типа, поэтому вложенная
 * ветка разворачивается тем же проходом.
 */
export interface SwitchBranch<T> {
  readonly [BRANCH]: BranchMeta<T>;
}

/** Элемент списка единиц: значение или ветка переключателя */
export type Branchable<T> = T | SwitchBranch<T>;

/**
 * Таблица веток `pick`: перечисляет все значения переключателя.
 *
 * Ветка — одно значение, массив значений или пустой массив. Неполную
 * таблицу отвергает компилятор: пропущенное значение оставило бы список
 * без состава.
 */
export type PickTable<Values extends string> = Readonly<
  Record<Values, unknown>
>;

/** Отвергает значение, которого нет в словаре переключателя */
export type NoExtraValues<Table, Values extends string> = Record<
  Exclude<keyof Table, Values>,
  never
>;

/** Элементы всех веток таблицы: массив разворачивается, одно значение — нет */
export type TableItems<Table> = {
  [V in keyof Table]: Table[V] extends readonly (infer Item)[]
    ? Item
    : Table[V];
}[keyof Table];

/**
 * Тип элемента после раскрытия: ветка исчезает, остаётся её содержимое.
 *
 * Благодаря ему `pick`, в чьей таблице стоит вложенная ветка, возвращает
 * ветку того же типа, что и список, в который она встаёт.
 */
export type Unbranch<T> = T extends SwitchBranch<infer U> ? U : T;

/**
 * Переключатель состава: имя, закрытый словарь значений и способ объявить
 * ветку.
 *
 * DI-токеном не является: выбор не инжектируется, и состав не протекает в
 * рантайм.
 *
 * @template Name - Имя переключателя; им же названо поле аргумента сборки
 * @template Values - Словарь значений
 * @template Default - Умолчание либо `undefined`, если его нет
 */
export interface Switch<
  Name extends string = string,
  Values extends string = string,
  Default extends Values | undefined = Values | undefined,
> {
  /** Имя переключателя: поле аргумента сборки и ключ карты значений */
  readonly name: Name;

  /** Значения в порядке объявления */
  readonly values: readonly Values[];

  /** Умолчание; `undefined` — значение обязано прийти аргументом сборки */
  readonly default: Default;

  /**
   * Standard Schema значений с умолчанием.
   *
   * Ею описывают поле секции конфига: `makeConfig('app', { storage:
   * Storage.schema })`. Валидатор для этого не нужен.
   */
  readonly schema: StandardSchemaV1<string, Values>;

  /**
   * Объявляет ветку состава таблицей «значение → элементы».
   *
   * @param table - Таблица, перечисляющая все значения переключателя
   * @returns Значение-ветку для списка единиц
   */
  pick<const Table extends PickTable<Values>>(
    table: Table & NoExtraValues<Table, Values>,
  ): SwitchBranch<Unbranch<TableItems<Table>>>;
}

/** Двухпозиционный переключатель: `'on' | 'off'` и сокращение `when` */
export interface ToggleSwitch<
  Name extends string = string,
  Default extends Toggle | undefined = Toggle | undefined,
> extends Switch<Name, Toggle, Default> {
  /**
   * Сокращение `pick({ on: items, off: [] })`.
   *
   * @param items - Элементы, входящие в состав при значении `'on'`
   * @returns Значение-ветку для списка единиц
   */
  when<T>(items: T | readonly T[]): SwitchBranch<Unbranch<T>>;
}

/** Переключатель, чьи параметры не важны */
export type AnySwitch = Switch<string, any, any>;

/**
 * Карта «имя переключателя → выбранное значение».
 *
 * Строится на фазе ASSEMBLE из аргумента сборки и умолчаний; раскрытие
 * читает только её.
 */
export type SwitchValues = Readonly<Record<string, string>>;
