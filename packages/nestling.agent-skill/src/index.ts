/**
 * Установка скилла в проект пользователя.
 *
 * Файлы скилла едут в тарболе каталогом `skill/` и кладутся в
 * `.claude/skills/nestling/`: агент Claude Code читает скиллы оттуда, а не
 * из `node_modules`.
 *
 * Рядом с ними команда пишет манифест — версию пакета и хэш каждого
 * положенного файла. По нему повторная установка отличает правленый файл
 * от просто старого: старый обновляется молча, правленый ждёт `--force`.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Каталог-источник: он лежит рядом с собранным файлом, а не рядом с
 * текущим каталогом. `npx` запускает команду из любого места, и
 * `process.cwd()` указывал бы на проект пользователя
 */
const SOURCE = fileURLToPath(new URL('../skill/', import.meta.url));

/** Манифест пакета: версия скилла и версия фреймворка — одно число */
const PACKAGE = fileURLToPath(new URL('../package.json', import.meta.url));

/** Имя манифеста установки внутри каталога скилла */
export const MANIFEST_NAME = '.manifest.json';

/** Куда команда кладёт скилл внутри проекта */
export const SKILL_PATH: string = join('.claude', 'skills', 'nestling');

/** Что команда положила в проект: версия пакета и хэш каждого файла */
export interface SkillManifest {
  /** Версия пакета, из которого шла установка */
  version: string;
  /** Хэш содержимого по пути файла относительно каталога скилла */
  files: Record<string, string>;
}

export interface InstallOptions {
  /** Каталог проекта. По умолчанию текущий */
  dir?: string;
  /** Перезаписывать файлы, которые разошлись с манифестом */
  force?: boolean;
}

/** Что команда сделала с каждым файлом скилла */
export interface InstallReport {
  /** Каталог скилла, куда шла запись */
  dir: string;
  /** Версия пакета, записанная в манифест */
  version: string;
  /** Файлы, которых не было */
  created: string[];
  /** Файлы, которые совпали с манифестом и заменены новой версией */
  updated: string[];
  /** Файлы, которые уже совпадали с источником */
  unchanged: string[];
  /** Файлы, которые разошлись с манифестом */
  diverged: string[];
  /** Расходящиеся файлы перезаписаны: команда шла с `force` */
  forced: boolean;
}

/**
 * Кладёт файлы скилла в `.claude/skills/nestling/` внутри `dir`.
 *
 * Файла нет — создаётся. Хэш совпал с манифестом — файл заменяется
 * содержимым источника молча. Хэш не совпал — файл попадает в `diverged`
 * и остаётся как есть; с `force` перезаписывается. Манифеста рядом нет —
 * сравнивать не с чем, и команда сравнивает файл с источником.
 */
export async function installSkill(
  options: InstallOptions = {},
): Promise<InstallReport> {
  const forced = options.force ?? false;
  const dir = resolve(options.dir ?? process.cwd(), SKILL_PATH);
  const version = await packageVersion();
  const manifest = await readManifest(dir);

  const report: InstallReport = {
    dir,
    version,
    created: [],
    updated: [],
    unchanged: [],
    diverged: [],
    forced,
  };

  const files: Record<string, string> = {};

  for (const name of await listFiles(SOURCE)) {
    const source = await readFile(join(SOURCE, name), 'utf8');
    const path = join(dir, name);
    const current = await readIfExists(path);
    const key = name.split(sep).join('/');

    if (current === null) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, source);
      report.created.push(name);
    } else if (current === source) {
      report.unchanged.push(name);
    } else if (manifest?.files[key] === hash(current)) {
      // Файл такой, каким его положила прежняя установка: правок нет,
      // и новая версия встаёт на его место молча
      await writeFile(path, source);
      report.updated.push(name);
    } else {
      report.diverged.push(name);

      if (forced) {
        await writeFile(path, source);
      } else {
        continue;
      }
    }

    files[key] = hash(source);
  }

  await writeManifest(dir, { version, files }, manifest);

  return report;
}

/** Версия пакета, из которого запущена команда */
async function packageVersion(): Promise<string> {
  const { version } = JSON.parse(await readFile(PACKAGE, 'utf8')) as {
    version: string;
  };

  return version;
}

/** Манифест рядом с файлами скилла или `null`, если его нет либо он битый */
async function readManifest(dir: string): Promise<SkillManifest | null> {
  const text = await readIfExists(join(dir, MANIFEST_NAME));

  if (text === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as SkillManifest;

    return typeof parsed.version === 'string' && parsed.files !== null
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** Пишет манифест, если он отличается от лежащего рядом */
async function writeManifest(
  dir: string,
  next: SkillManifest,
  current: SkillManifest | null,
): Promise<void> {
  const text = `${JSON.stringify(next, null, 2)}\n`;

  if (current !== null && `${JSON.stringify(current, null, 2)}\n` === text) {
    return;
  }

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, MANIFEST_NAME), text);
}

/** Хэш содержимого файла */
function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
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
