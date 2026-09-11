/**
 * Установка скилла во временный каталог: три исхода по файлу и `--dir`.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installSkill, SKILL_PATH } from './index.js';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

let project: string;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'nestling-skill-'));
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

/** Путь файла скилла внутри проекта */
const inProject = (name: string): string =>
  join(project, SKILL_PATH, ...name.split('/'));

describe('installSkill', () => {
  it('создаёт скилл в проекте без каталога .claude', async () => {
    const report = await installSkill({ dir: project });

    expect(report.created).toContain('SKILL.md');
    expect(report.created).toContain(join('references', 'errors.md'));
    expect(report.unchanged).toEqual([]);
    expect(report.diverged).toEqual([]);
    expect(await readFile(inProject('SKILL.md'), 'utf8')).toContain(
      'name: nestling',
    );
  });

  it('второй запуск подряд ничего не пишет', async () => {
    const first = await installSkill({ dir: project });
    const second = await installSkill({ dir: project });

    expect(second.created).toEqual([]);
    expect(second.diverged).toEqual([]);
    expect(second.unchanged).toEqual(first.created);
  });

  it('оставляет дописанный пользователем файл и называет его', async () => {
    await installSkill({ dir: project });
    const mine = `${await readFile(inProject('SKILL.md'), 'utf8')}\nMine.\n`;
    await writeFile(inProject('SKILL.md'), mine);

    const report = await installSkill({ dir: project });

    expect(report.diverged).toEqual(['SKILL.md']);
    expect(report.forced).toBe(false);
    expect(await readFile(inProject('SKILL.md'), 'utf8')).toBe(mine);
  });

  it('перезаписывает расходящийся файл по force', async () => {
    await installSkill({ dir: project });
    const packaged = await readFile(inProject('SKILL.md'), 'utf8');
    await writeFile(inProject('SKILL.md'), `${packaged}\nMine.\n`);

    const report = await installSkill({ dir: project, force: true });

    expect(report.diverged).toEqual(['SKILL.md']);
    expect(report.forced).toBe(true);
    expect(await readFile(inProject('SKILL.md'), 'utf8')).toBe(packaged);
  });

  it('пишет в каталог из dir, а не в текущий', async () => {
    const nested = join(project, 'apps', 'api');

    const report = await installSkill({ dir: nested });

    expect(report.dir).toBe(join(nested, SKILL_PATH));
    expect(await readFile(join(report.dir, 'SKILL.md'), 'utf8')).toContain(
      'name: nestling',
    );
  });

  it('без dir пишет относительно текущего каталога', async () => {
    const cwd = process.cwd();

    try {
      process.chdir(project);
      const report = await installSkill();

      expect(report.created).toContain('SKILL.md');
    } finally {
      process.chdir(cwd);
    }
  });
});
