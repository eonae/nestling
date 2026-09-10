/**
 * Раскрытие веток: одна чистая функция, вызываемая там, где список
 * читается.
 *
 * `providers:` и `dependsOn:` модуля раскрывает `ContainerBuilder`, списки
 * единиц и корня — `@nestlingjs/app`. Второго прохода со своей логикой нет:
 * состав каждой ветки читается одинаково, откуда бы ни пришёл список.
 */

import { isSwitchBranch, unknownValueMessage } from './make-switch.js';
import type {
  AnySwitch,
  Branchable,
  SwitchBranch,
  SwitchValues,
} from './types.js';
import { BRANCH } from './types.js';

/**
 * Переключатель ветки.
 *
 * @param branch - Значение, созданное `pick` или `when`
 * @returns Переключатель, чьё значение выбирает элементы ветки
 */
export const switchOf = (branch: SwitchBranch<unknown>): AnySwitch =>
  branch[BRANCH].switch;

/** Текст отказа по умолчанию: ветка есть, а значений билдеру не передали */
const missingValueMessage = (declared: AnySwitch): string =>
  `A branch of switch '${declared.name}' is registered, but no value for it ` +
  `was given. Pass the values in the 'switches' option of the builder: ` +
  `new ContainerBuilder({ switches: { ${declared.name}: ` +
  `'${declared.values[0]}' } }).`;

/**
 * Раскрывает ветки списка в элементы выбранных значений.
 *
 * Ветка раскрывается в ноль и больше элементов того же типа; ветка внутри
 * ветки разворачивается тем же проходом. Функция синхронна и не выполняет
 * ввод-вывод: значения известны до неё.
 *
 * @param items - Список единиц, возможно с ветками
 * @param values - Карта «имя переключателя → выбранное значение»
 * @param missing - Ошибка на ветке переключателя без значения; у корня и у
 * билдера она своя
 * @returns Список без веток, в порядке объявления
 * @throws {Error} Ветка переключателя, значения которого нет в карте, либо
 * значение вне словаря переключателя
 */
export function resolveBranches<T>(
  items: readonly Branchable<T>[] | undefined,
  values: SwitchValues,
  missing: (declared: AnySwitch) => Error = (declared) =>
    new Error(missingValueMessage(declared)),
): T[] {
  const resolved: T[] = [];

  const visit = (list: readonly Branchable<T>[]): void => {
    for (const item of list) {
      if (!isSwitchBranch(item)) {
        resolved.push(item as T);
        continue;
      }

      const { switch: declared, table } = (item as SwitchBranch<Branchable<T>>)[
        BRANCH
      ];
      const chosen = values[declared.name];

      if (chosen === undefined) {
        throw missing(declared);
      }

      if (!(declared.values as readonly string[]).includes(chosen)) {
        throw new Error(
          unknownValueMessage(declared.name, declared.values, chosen),
        );
      }

      visit(table[chosen] ?? []);
    }
  };

  visit(items ?? []);

  return resolved;
}

/**
 * Элементы **всех** веток списка, без выбора.
 *
 * Нужна проверкам, которые работают раньше значений: словарь `intercom:`
 * перечисляет транспорты, объявленные любой веткой, а перечень
 * переключателей корня сверяется с теми, что встретились в составе.
 *
 * @param items - Список единиц, возможно с ветками
 * @returns Элементы списка и всех веток, в порядке объявления
 */
export function branchCandidates<T>(
  items: readonly Branchable<T>[] | undefined,
): T[] {
  const found: T[] = [];

  const visit = (list: readonly Branchable<T>[]): void => {
    for (const item of list) {
      if (!isSwitchBranch(item)) {
        found.push(item as T);
        continue;
      }

      for (const branch of Object.values(
        (item as SwitchBranch<Branchable<T>>)[BRANCH].table,
      )) {
        visit(branch);
      }
    }
  };

  visit(items ?? []);

  return found;
}

/**
 * Переключатели, использованные ветками списка, в порядке встречи.
 *
 * По ней корень проверяет, что каждый `pick` стоит на переключателе из
 * `switches:`.
 *
 * @param items - Список единиц, возможно с ветками
 * @returns Переключатели без повторов
 */
export function switchesUsed<T>(
  items: readonly Branchable<T>[] | undefined,
): AnySwitch[] {
  const found: AnySwitch[] = [];
  const seen = new Set<AnySwitch>();

  const visit = (list: readonly Branchable<T>[]): void => {
    for (const item of list) {
      if (!isSwitchBranch(item)) {
        continue;
      }

      const { switch: declared, table } = (item as SwitchBranch<Branchable<T>>)[
        BRANCH
      ];

      if (!seen.has(declared)) {
        seen.add(declared);
        found.push(declared);
      }

      for (const branch of Object.values(table)) {
        visit(branch);
      }
    }
  };

  visit(items ?? []);

  return found;
}
