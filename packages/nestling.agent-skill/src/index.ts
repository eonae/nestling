/**
 * Установка скилла в проект пользователя.
 *
 * Файлы скилла едут в тарболе каталогом `skill/` и кладутся в
 * `.claude/skills/nestling/`: агент Claude Code читает скиллы оттуда, а не
 * из `node_modules`.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Каталог-источник: он лежит рядом с собранным файлом, а не рядом с
 * текущим каталогом. `npx` запускает команду из любого места, и
 * `process.cwd()` указывал бы на проект пользователя
 */
const SOURCE = fileURLToPath(new URL('../skill/', import.meta.url));

/** Куда команда кладёт скилл внутри проекта */
export const SKILL_PATH = join('.claude', 'skills', 'nestling');

export interface InstallOptions {
  /** Каталог проекта. По умолчанию текущий */
  dir?: string;
  /** Перезаписывать файлы, которые разошлись с источником */
  force?: boolean;
}

/** Что команда сделала с каждым файлом скилла */
export interface InstallReport {
  /** Каталог скилла, куда шла запись */
  dir: string;
  /** Файлы, которых не было */
  created: string[];
  /** Файлы, которые совпали с источником */
  unchanged: string[];
  /** Файлы, которые отличаются от источника */
  diverged: string[];
  /** Расходящиеся файлы перезаписаны: команда шла с `force` */
  forced: boolean;
}

/**
 * Кладёт файлы скилла в `.claude/skills/nestling/` внутри `dir`.
 *
 * Файла нет — создаётся. Файл совпал — не трогается. Файл разошёлся —
 * попадает в `diverged` и остаётся как есть; с `force` перезаписывается.
 */
export async function installSkill(
  options: InstallOptions = {},
): Promise<InstallReport> {
  const forced = options.force ?? false;
  const dir = resolve(options.dir ?? process.cwd(), SKILL_PATH);

  const report: InstallReport = {
    dir,
    created: [],
    unchanged: [],
    diverged: [],
    forced,
  };

  for (const name of await listFiles(SOURCE)) {
    const source = await readFile(join(SOURCE, name), 'utf8');
    const path = join(dir, name);
    const current = await readIfExists(path);

    if (current === null) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, source);
      report.created.push(name);
    } else if (current === source) {
      report.unchanged.push(name);
    } else {
      report.diverged.push(name);

      if (forced) {
        await writeFile(path, source);
      }
    }
  }

  return report;
}

/** Пути всех файлов каталога относительно него самого, по алфавиту */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/** Содержимое файла или `null`, если файла нет */
async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}
