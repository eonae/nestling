/**
 * Аргумент сборки: выбор фич и значения переключателей одним значением.
 *
 * Аргумент принадлежит сборке, а не декларации: он меняет состав процесса,
 * а не приложения. Тип объектной формы выводится из `switches:` корня —
 * поле переключателя с умолчанием необязательно, без умолчания
 * обязательно.
 */

import type { ArgvArgs } from './argv.js';
import { isArgv } from './argv.js';
import { parseCommandLine } from './command-line.js';

import type { AnySwitch, SwitchValues } from '@nestlingjs/container';

/** Поля объектной формы аргумента сборки, занятые выбором фич */
export const RESERVED_ARG_FIELDS = ['features', 'includeDeps'] as const;

/**
 * Имена, занятые аргументом сборки: поля объектной формы и флаги.
 *
 * Переключателю они запрещены. `include-deps` и `help` полями не бывают,
 * но флагами бывают, и переключатель с таким именем отобрал бы флаг.
 */
export const RESERVED_SWITCH_NAMES = [
  'features',
  'includeDeps',
  'include-deps',
  'help',
] as const;

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

/**
 * Сводит пересечение к одному рекорду, сохраняя `readonly` и
 * необязательность.
 *
 * Без сведения компилятор откладывает проверку «нет общих полей»: маркер
 * `argv` прошёл бы туда, где ждут объектную форму, — например элементом
 * матрицы топологий.
 */
type Flatten<T> = { [K in keyof T]: T[K] };

/** Объектная форма аргумента сборки */
export type BuildObject<S extends readonly AnySwitch[]> = Flatten<
  {
    /** Имена выбранных фич либо `'all'` */
    readonly features?: string | readonly string[];

    /**
     * Замкнуть выбор по вызываемым операциям видов `request` и `command`.
     *
     * События в замыкании не участвуют: у события ноль или больше
     * подписчиков, и отсутствие подписчика в этом процессе допустимо.
     */
    readonly includeDeps?: boolean;
  } & SwitchFields<S>
>;

/**
 * Аргумент `build`, `discover` и `check`.
 *
 * Форм две. Объектная несёт выбор фич, `includeDeps` и значения
 * переключателей; её поля проверяет компилятор. Маркер `argv(process.argv)`
 * несёт командную строку: её содержимое известно в работе, а не при
 * компиляции, поэтому маркер присвоим аргументу любой декларации, а
 * ошибки разбора становятся отказом до фазы 0.
 */
export type BuildArgs<S extends readonly AnySwitch[] = []> =
  | BuildObject<S>
  | ArgvArgs;

/** Разобранный аргумент сборки: выбор фич отдельно от значений */
export interface ParsedArgs {
  /** Имена выбранных фич либо `'all'`; отсутствует — выбраны все */
  readonly features?: string | readonly string[];

  /** Замкнуть выбор по вызываемым операциям */
  readonly includeDeps: boolean;

  /** Значения переключателей, названные аргументом */
  readonly given: Readonly<Record<string, unknown>>;
}

/**
 * Разбирает аргумент сборки на выбор фич, флаг замыкания и значения
 * переключателей.
 *
 * Обе формы дают одно значение: ниже разбора о происхождении никто не
 * знает. Перечень полей объектной формы закрыт: неизвестное поле — ошибка,
 * перечисляющая известные. Молчаливое игнорирование пропустило бы опечатку
 * в имени переключателя с умолчанием, и приложение поднялось бы с другим
 * составом, чем просил автор.
 *
 * `--help` обслуживается здесь: текст строит чистая функция, а печать в
 * `stdout` и выход кодом `0` остаются тремя строками на границе. Другого
 * разумного исхода у входа `build(argv(…)).run()` нет, а `catch` в каждой
 * точке входа печатал бы стек вместо справки.
 *
 * @param args - Аргумент в одной из двух форм
 * @param switches - Переключатели, объявленные корнем
 * @param features - Имена объявленных фич — для текста справки
 * @returns Разобранный аргумент
 * @throws {Error} Неизвестное поле объектной формы либо отказ разбора
 * командной строки
 */
export function parseArgs(
  args: BuildArgs<any> | undefined,
  switches: readonly AnySwitch[],
  features: readonly string[] = [],
): ParsedArgs {
  if (args === undefined) {
    return { includeDeps: false, given: {} };
  }

  if (isArgv(args)) {
    const line = parseCommandLine(args.strings, { features, switches });

    if (line.help) {
      process.stdout.write(line.text);

      // Выход процесса — поведение командной строки, а не библиотеки:
      // `--help` печатает схему и завершает процесс
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(0);
    }

    return line.parsed;
  }

  const known = new Set<string>([
    ...RESERVED_ARG_FIELDS,
    ...switches.map(({ name }) => name),
  ]);

  const given: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(args)) {
    if (!known.has(field)) {
      throw new Error(
        `Unknown field '${field}' in the build argument. Known fields: ` +
          `${[...known].map((name) => `'${name}'`).join(', ')}. The list is ` +
          `closed, so a typo cannot silently build a different composition.`,
      );
    }

    if (!(RESERVED_ARG_FIELDS as readonly string[]).includes(field)) {
      given[field] = value;
    }
  }

  return {
    ...(args.features !== undefined && {
      features: args.features as string | readonly string[],
    }),
    includeDeps: args.includeDeps === true,
    given,
  };
}

/**
 * Сопоставляет каждому объявленному переключателю значение: из аргумента
 * или из умолчания.
 *
 * Шаг 2 фазы BUILD — до раскрытия веток и до discovery.
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
        `Switch '${declared.name}' has no default, and the build argument ` +
          `does not set it. Pass it as the '${declared.name}' field: ` +
          `app.build({ ${declared.name}: '${declared.values[0]}' }).`,
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
 * @returns Ошибка фазы BUILD
 */
export const undeclaredSwitch = (declared: AnySwitch): Error =>
  new Error(
    `Switch '${declared.name}' is used by a branch in the composition, but ` +
      `it is not declared in 'switches:' of makeApp({ … }). Add it there — ` +
      `the dictionary of switches belongs to the root, like the list of ` +
      `features.`,
  );
