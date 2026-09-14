/** Типы `scripts/freshness.mjs`: спека вызывает проверку напрямую */

/** Находка проверки: где встретилось удалённое имя и откуда оно взято */
export interface RemovedNameFinding {
  file: string;
  line: number;
  message: string;
}

/** Ячейка таблицы, которую проверка именем не сочла, и почему */
export interface SkippedCell {
  release: string;
  cell: string;
  reason: string;
}

/** Удалённое имя со строкой таблицы, из которой оно взято */
export interface RemovedName {
  name: string;
  row: string;
  release: string;
  to: string;
}

/** Каталог заметок о выпусках */
export declare const RELEASES_DIR: string;

/** Ищет удалённые имена в файлах скилла и печатает границу проверки */
export declare function checkRemovedNames(): {
  findings: RemovedNameFinding[];
  skipped: SkippedCell[];
  exceptions: [string, string][];
};

/** Собирает удалённые имена по таблицам переименований всех заметок */
export declare function removedNames(): {
  names: RemovedName[];
  skipped: SkippedCell[];
};

/** Ячейка перечисляет имена, а не описывает поведение */
export declare function listsNames(cell: string): boolean;
