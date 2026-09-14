/**
 * Свежесть скилла: версия в тексте и удалённые имена.
 *
 * Скилл едет в проект копией и сам себя не обновляет. Компилятор держит
 * сниппеты, а прозу и таблицы — только эта проверка: имя, удалённое
 * выпуском, в тексте скилла встречаться не должно.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkRemovedNames } from '../scripts/freshness.mjs';
import { SKILL_DIR } from '../scripts/snippets.mjs';

import { describe, expect, it } from 'vitest';

const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');

/** Вводная часть: текст до первого заголовка второго уровня */
const intro = skill.split('\n## ')[0];

/** Версия пакета: скилл и фреймворк выходят одним числом */
const { version } = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../package.json', import.meta.url)),
    'utf8',
  ),
) as { version: string };

describe('версия скилла', () => {
  it('совпадает с версией пакета', () => {
    const named = /This skill describes Nestling (\S+)\./.exec(intro)?.[1];

    expect(
      named,
      'вводная часть SKILL.md не называет версию Nestling',
    ).toBeDefined();
    expect(named, `в SKILL.md ${named}, в package.json ${version}`).toBe(
      version,
    );
  });

  it('вводная часть называет правило сверки с проектом', () => {
    expect(intro).toContain('@nestlingjs/app');
    expect(intro).toContain('package.json');
    expect(intro).toContain('npx @nestlingjs/agent-skill');
  });
});

describe('удалённые имена', () => {
  it('в тексте скилла не встречаются', () => {
    const { findings, skipped, exceptions } = checkRemovedNames();

    // Граница проверки видна тому, кто читает отказ: ячейки, которые
    // проверка именем не сочла, и исключения с причинами
    const boundary = [
      ...skipped.map(
        ({ release, cell, reason }) => `${release}: ${cell} — ${reason}`,
      ),
      ...exceptions.map(([name, reason]) => `исключение ${name} — ${reason}`),
    ].join('\n');

    expect(
      findings.map(({ file, line, message }) => `${file}:${line} — ${message}`),
      `граница проверки:\n${boundary}`,
    ).toEqual([]);
  });
});
