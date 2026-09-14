/**
 * Маркер командной строки — вторая форма аргумента сборки.
 *
 * Маркер несёт список строк и ничего не разбирает: схема флагов
 * принадлежит декларации, а не значению. Ядро `process.argv` не читает —
 * список передаёт точка входа.
 */

/**
 * Бренд маркера: symbol-свойство с ключом из глобального реестра.
 *
 * По нему разбор отличает маркер от объектной формы. Ключ из реестра
 * переживает две копии пакета в одном процессе.
 */
export const ARGV: unique symbol = Symbol.for('nestling:argv');

/** Аргументы командной строки, переданные аргументом сборки */
export interface ArgvArgs {
  readonly [ARGV]: true;

  /** Список целиком: путь к исполняемому файлу, путь к скрипту и флаги */
  readonly strings: readonly string[];
}

/**
 * Передаёт аргументы командной строки аргументом сборки.
 *
 * Список принимается целиком — `argv(process.argv)`. Первые два элемента
 * (путь к исполняемому файлу и путь к скрипту) отбрасывает разбор; второй
 * нужен ему для строки вызова в тексте `--help`.
 *
 * Срезанный список отвергается: ведущий дефис в первом или втором
 * элементе означает, что два элемента уже отрезаны, и разбор отбросил бы
 * два первых флага. Процесс поднялся бы другим составом, а такую ошибку
 * никто не ищет.
 *
 * @param strings - `process.argv` целиком
 * @returns Замороженный маркер для `build`, `discover` и `check`
 * @throws {TypeError} Список срезан
 *
 * @example
 * ```typescript
 * await app.build(argv(process.argv)).run();
 * ```
 */
export function argv(strings: readonly string[]): ArgvArgs {
  const flag = strings.slice(0, 2).find((value) => value.startsWith('-'));

  if (flag !== undefined) {
    throw new TypeError(
      `argv(…) got '${flag}' among the first two entries, so the list is ` +
        `already sliced. Pass process.argv whole: argv(process.argv). The ` +
        `parser drops the first two entries itself, and dropping them twice ` +
        `would silently build a different composition.`,
    );
  }

  const marker: ArgvArgs = {
    [ARGV]: true,
    strings: Object.freeze([...strings]),
  };

  return Object.freeze(marker);
}

/**
 * Маркер ли это командной строки.
 *
 * @param value - Аргумент сборки в любой форме
 * @returns `true`, если значение создано `argv(…)`
 */
export const isArgv = (value: unknown): value is ArgvArgs =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<symbol, unknown>)[ARGV] === true;
