/**
 * Состав скилла: перечень файлов, ссылки, потолки строк, части `SKILL.md`.
 *
 * Проверки держат форму, на которую рассчитан читатель скилла — агент.
 * Файл `references/` без ссылки из `SKILL.md` он не найдёт, а файл сверх
 * потолка вытеснит из контекста код пользователя.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SKILL_DIR, SNIPPETS_DIR } from '../scripts/snippets.mjs';

import nestlingPlugin from '@nestlingjs/eslint-plugin';
import { describe, expect, it } from 'vitest';

/** Файлы `references/`, которые обязан содержать скилл */
const REFERENCES = [
  'config.md',
  'container.md',
  'diagnostics.md',
  'endpoints.md',
  'errors.md',
  'features.md',
  'from-nest.md',
  'http.md',
  'observability.md',
  'packages.md',
  'pipeline.md',
  'setup.md',
  'storage.md',
  'testing.md',
];

/** Части `SKILL.md` в том порядке, в котором их читает агент */
const PARTS = [
  '## What is different from NestJS',
  '## Service skeleton',
  '## A minimal application',
  '## Rules the compiler or BUILD catches',
  '## Where to look next',
];

const LIMITS = { skill: 250, reference: 200 };

/** Каталог пакетов репозитория: источник перечня публикуемых имён */
const PACKAGES_DIR = fileURLToPath(
  new URL('../../../packages/', import.meta.url),
);

const read = (...path: string[]): string =>
  readFileSync(join(SKILL_DIR, ...path), 'utf8');

const skill = read('SKILL.md');

describe('состав скилла', () => {
  it('состоит из SKILL.md и каталога references/', () => {
    const top = readdirSync(SKILL_DIR, { withFileTypes: true });

    expect(top.filter((e) => e.isFile()).map((e) => e.name)).toEqual([
      'SKILL.md',
    ]);
    expect(top.filter((e) => e.isDirectory()).map((e) => e.name)).toEqual([
      'references',
    ]);
  });

  it('references/ содержит ровно четырнадцать файлов перечня', () => {
    expect(readdirSync(join(SKILL_DIR, 'references')).sort()).toEqual(
      REFERENCES,
    );
  });

  it('каждый файл references/ назван в SKILL.md, и наоборот', () => {
    const linked = [
      ...new Set(
        [...skill.matchAll(/references\/([a-z-]+\.md)/g)].map(
          ([, name]) => name,
        ),
      ),
    ].sort();

    expect(linked).toEqual(REFERENCES);
  });
});

describe('каталог пакетов', () => {
  it('называет каждый публикуемый пакет репозитория, и только его', () => {
    const named = [
      ...new Set(
        [
          ...read('references', 'packages.md').matchAll(
            /`(@nestlingjs\/[\w.-]+)`/g,
          ),
        ].map(([, name]) => name),
      ),
    ].sort();

    expect(named).toEqual(publishedPackages());
  });

  it('таблицы пакетов в SKILL.md нет', () => {
    expect(skill).not.toMatch(/^\| `@nestlingjs\//m);
  });
});

describe('таблица фаз', () => {
  it('перечисляет номера фаз подряд, без пропусков', () => {
    const numbers = [
      ...read('references', 'container.md').matchAll(/^\| (\d+) [A-Z]+ \|/gm),
    ].map(([, number]) => Number(number));

    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers).toEqual(numbers.map((_, index) => index));
  });
});

describe('имена правил ESLint', () => {
  it('каждое имя из скилла есть среди правил плагина', () => {
    // Имя правила отличает двоеточие сразу за кавычкой: так пишут ключ в
    // `rules:`, а импорт пакета за кавычкой несёт `;` либо конец строки
    const named = [
      ...new Set(
        skillFiles().flatMap(([, path]) =>
          [
            ...readFileSync(path, 'utf8').matchAll(/'@nestlingjs\/([\w-]+)':/g),
          ].map(([, rule]) => rule),
        ),
      ),
    ].sort();

    expect(named).not.toEqual([]);
    expect(named.filter((rule) => !(rule in nestlingPlugin.rules))).toEqual([]);
  });
});

describe('SKILL.md', () => {
  it('начинается с frontmatter с name и description', () => {
    const [, frontmatter] = /^---\n([\S\s]*?)\n---\n/.exec(skill) ?? [];

    expect(frontmatter).toBeDefined();
    expect(frontmatter).toMatch(/^name: nestling$/m);
    expect(frontmatter).toMatch(/^description: \S/m);
  });

  it('состоит из пяти частей в заданном порядке', () => {
    expect(skill.split('\n').filter((line) => line.startsWith('## '))).toEqual(
      PARTS,
    );
  });
});

describe('потолки строк', () => {
  it('SKILL.md не длиннее потолка', () => {
    expect(lines('SKILL.md')).toBeLessThanOrEqual(LIMITS.skill);
  });

  it.each(REFERENCES)('references/%s не длиннее потолка', (name) => {
    expect(lines('references', name)).toBeLessThanOrEqual(LIMITS.reference);
  });
});

describe('язык', () => {
  it.each(skillAndSnippets())('в %s нет кириллицы', (_name, path) => {
    const found = readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, index) => (/[а-яё]/i.test(line) ? [index + 1] : []));

    expect(found).toEqual([]);
  });
});

/**
 * Имена публикуемых пакетов репозитория по алфавиту.
 *
 * Каталог без манифеста пакетом не является и в перечень не идёт. Такой
 * каталог остаётся от переименованного пакета: в нём один `dist`,
 * содержимое `dist` не отслеживается, и переименование папку не уносит.
 */
function publishedPackages(): string[] {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PACKAGES_DIR, entry.name, 'package.json'))
    .filter((path) => existsSync(path))
    .map(
      (path) =>
        JSON.parse(readFileSync(path, 'utf8')) as {
          name: string;
          private?: boolean;
        },
    )
    .filter((manifest) => manifest.private !== true)
    .map((manifest) => manifest.name)
    .sort();
}

/** Число строк файла скилла */
function lines(...path: string[]): number {
  return read(...path).split('\n').length;
}

/** Пары «имя, путь» для всех файлов скилла и всех сниппетов */
function skillAndSnippets(): [string, string][] {
  return [...skillFiles(), ...collect(SNIPPETS_DIR, 'snippets')];
}

/** Пары «имя, путь» для файлов скилла: `SKILL.md` и `references/` */
function skillFiles(): [string, string][] {
  return collect(SKILL_DIR, 'skill');
}

/** Файлы каталога парами «имя с префиксом, полный путь» */
function collect(dir: string, prefix: string): [string, string][] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => [
      `${prefix}/${entry.name}`,
      join(entry.parentPath, entry.name),
    ]);
}
