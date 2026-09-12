/**
 * Состав скилла: перечень файлов, ссылки, потолки строк, части `SKILL.md`.
 *
 * Проверки держат форму, на которую рассчитан читатель скилла — агент.
 * Файл `references/` без ссылки из `SKILL.md` он не найдёт, а файл сверх
 * потолка вытеснит из контекста код пользователя.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SKILL_DIR, SNIPPETS_DIR } from '../scripts/snippets.mjs';

import { describe, expect, it } from '@jest/globals';

/** Файлы `references/`, которые обязан содержать скилл */
const REFERENCES = [
  'config.md',
  'container.md',
  'endpoints.md',
  'errors.md',
  'features.md',
  'from-nest.md',
  'pipeline.md',
  'testing.md',
];

/** Части `SKILL.md` в том порядке, в котором их читает агент */
const PARTS = [
  '## What is different from NestJS',
  '## Service skeleton',
  '## A minimal application',
  '## Rules the compiler or ASSEMBLE catches',
  '## Where to look next',
];

const LIMITS = { skill: 250, reference: 200 };

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

  it('references/ содержит ровно восемь файлов перечня', () => {
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

/** Число строк файла скилла */
function lines(...path: string[]): number {
  return read(...path).split('\n').length;
}

/** Пары «имя, путь» для всех файлов скилла и всех сниппетов */
function skillAndSnippets(): [string, string][] {
  return [...collect(SKILL_DIR, 'skill'), ...collect(SNIPPETS_DIR, 'snippets')];
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
