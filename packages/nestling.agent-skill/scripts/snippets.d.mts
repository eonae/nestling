/** Типы `scripts/snippets.mjs`: спека вызывает сверку напрямую */

/** Находка сверки: где, в какой строке и что не сошлось */
export interface SnippetFinding {
  file: string;
  line: number;
  message: string;
}

/** Каталог скилла */
export declare const SKILL_DIR: string;

/** Каталог сниппетов */
export declare const SNIPPETS_DIR: string;

/** Сверяет блоки кода с файлами сниппетов в обе стороны */
export declare function checkSnippets(): SnippetFinding[];

/** Переписывает тела помеченных блоков из файлов; возвращает изменённые */
export declare function writeSnippets(): string[];
