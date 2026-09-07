/**
 * Аргумент сборки: выбор фич и значения переключателей одним значением.
 *
 * Аргумент принадлежит сборке, а не декларации: он меняет состав процесса,
 * а не приложения. Тип объектной формы выводится из `switches:` корня —
 * поле переключателя с умолчанием необязательно, без умолчания
 * обязательно.
 */

import type { AnySwitch, SwitchValues } from '@nestling/container';

/** Поля аргумента сборки, занятые выбором фич */
export const RESERVED_ARG_FIELDS = ['features', 'includeDeps'] as const;

/** Есть ли у переключателя умолчание — по нему поле аргумента опционально */
type HasDefault<S extends AnySwitch> = [S['default']] extends [undefined]
  ? false
  : true;

/** Поля аргумента сборки, выведенные из словаря `switches:` */
export type SwitchFields<S extends readonly AnySwitch[]> = {
  [K in S[number] as HasDefault<K> extends true
    ? never
    : K['name']]: K['values'][number];
} & {
  [K in S[number] as HasDefault<K> extends true
    ? K['name']
    : never]?: K['values'][number];
};

/** Объектная форма аргумента сборки */
export type AssembleObject<S extends readonly AnySwitch[]> = {
  /** Имена выбранных фич либо `'all'` */
  readonly features?: string | readonly string[];

  /**
   * Замкнуть выбор по вызываемым операциям видов `request` и `command`.
   *
   * События в замыкании не участвуют: у события ноль или больше
   * подписчиков, и отсутствие подписчика в этом процессе допустимо.
   */
  readonly includeDeps?: boolean;
} & SwitchFields<S>;

/**
 * Аргумент `assemble` и `check`.
 *
 * Строковая форма — граница процесса (аргумент бинарника, переменная
 * окружения), она строковая по природе и задаёт только выбор фич.
 * Объектная форма добавляет `includeDeps` и значения переключателей;
 * `load(RootConfig)` подходит ею целиком, когда имена полей совпадают с
 * именами переключателей.
 */
export type AssembleArgs<S extends readonly AnySwitch[] = []> =
  | string
  | readonly string[]
  | AssembleObject<S>;

/** Разобранный аргумент сборки: выбор фич отдельно от значений */
export interface ParsedArgs {
  /** Имена выбранных фич либо `'all'`; отсутствует — выбраны все */
  readonly features?: string | readonly string[];

  /** Замкнуть выбор по вызываемым операциям */
  readonly includeDeps: boolean;

  /** Значения переключателей, названные аргументом */
  readonly given: Readonly<Record<string, unknown>>;

  /** Был ли аргумент объектной формой — для текста ошибок */
  readonly object: boolean;
}

/** Объектная ли это форма аргумента: не строка и не массив имён */
const isObjectForm = (args: unknown): args is Record<string, unknown> =>
  typeof args === 'object' && args !== null && !Array.isArray(args);

/**
 * Разбирает аргумент сборки на выбор фич, флаг замыкания и значения
 * переключателей.
 *
 * Перечень полей объектной формы закрыт: неизвестное поле — ошибка,
 * перечисляющая известные. Молчаливое игнорирование пропустило бы опечатку
 * в имени переключателя с умолчанием, и приложение поднялось бы с другим
 * составом, чем просил автор.
 *
 * @param args - Аргумент в любой из трёх форм
 * @param switches - Переключатели, объявленные корнем
 * @returns Разобранный аргумент
 * @throws {Error} Неизвестное поле объектной формы
 */
export function parseArgs(
  args: AssembleArgs<any> | undefined,
  switches: readonly AnySwitch[],
): ParsedArgs {
  if (args === undefined) {
    return { includeDeps: false, given: {}, object: false };
  }

  if (!isObjectForm(args)) {
    return { features: args, includeDeps: false, given: {}, object: false };
  }

  const known = new Set<string>([
    ...RESERVED_ARG_FIELDS,
    ...switches.map(({ name }) => name),
  ]);

  const given: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(args)) {
    if (!known.has(field)) {
      throw new Error(
        `Unknown field '${field}' in the assembly argument. Known fields: ` +
          `${[...known].map((name) => `'${name}'`).join(', ')}. The list is ` +
          `closed, so a typo cannot silently assemble a different composition.`,
      );
    }

    if (!(RESERVED_ARG_FIELDS as readonly string[]).includes(field)) {
      given[field] = value;
    }
  }

  return {
    ...(args.features === undefined
      ? {}
      : { features: args.features as string | readonly string[] }),
    includeDeps: args.includeDeps === true,
    given,
    object: true,
  };
}

/**
 * Сопоставляет каждому объявленному переключателю значение: из аргумента
 * или из умолчания.
 *
 * Шаг 2 фазы ASSEMBLE — до раскрытия веток и до discovery.
 *
 * @param switches - Переключатели, объявленные корнем
 * @param parsed - Разобранный аргумент сборки
 * @returns Карта «имя переключателя → выбранное значение»
 * @throws {Error} Значение не из словаря либо значение без умолчания не
 * передано
 */
export function resolveSwitchValues(
  switches: readonly AnySwitch[],
  parsed: ParsedArgs,
): SwitchValues {
  const values: Record<string, string> = {};

  for (const declared of switches) {
    const given = parsed.given[declared.name];
    const chosen = given === undefined ? declared.default : given;

    if (chosen === undefined) {
      throw new Error(
        `Switch '${declared.name}' has no default, and the assembly argument ` +
          `does not set it. Pass it as the '${declared.name}' field: ` +
          `app.assemble({ ${declared.name}: '${declared.values[0]}' }).`,
      );
    }

    if (
      typeof chosen !== 'string' ||
      !(declared.values as readonly string[]).includes(chosen)
    ) {
      throw new Error(
        `Switch '${declared.name}' has no value ${JSON.stringify(chosen)}. ` +
          `Allowed values: ` +
          `${declared.values.map((value: string) => `'${value}'`).join(', ')}.`,
      );
    }

    values[declared.name] = chosen;
  }

  return Object.freeze(values);
}

/**
 * Ошибка на ветке переключателя, которого нет в `switches:` корня.
 *
 * Значения объявленных переключателей карта содержит всегда, поэтому
 * промах по ней означает ровно это.
 *
 * @param declared - Переключатель ветки
 * @returns Ошибка фазы ASSEMBLE
 */
export const undeclaredSwitch = (declared: AnySwitch): Error =>
  new Error(
    `Switch '${declared.name}' is used by a branch in the composition, but ` +
      `it is not declared in 'switches:' of makeApp({ … }). Add it there — ` +
      `the dictionary of switches belongs to the root, like the list of ` +
      `features.`,
  );
