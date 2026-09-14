/**
 * Установка скилла во временный каталог: четыре исхода по файлу и `--dir`.
 *
 * Манифест — то, чем повторная установка отличает правленый файл от просто
 * старого. Поэтому проверки идут парами: один и тот же старый файл
 * обновляется молча, когда манифест его признаёт, и ждёт `--force`, когда
 * не признаёт.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installSkill, MANIFEST_NAME, SKILL_PATH } from './index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

/** Манифест установки, лежащий рядом с файлами скилла */
const manifest = async (): Promise<{
  version: string;
  files: Record<string, string>;
}> =>
  JSON.parse(await readFile(inProject(MANIFEST_NAME), 'utf8')) as {
    version: string;
    files: Record<string, string>;
  };

describe('installSkill', () => {
  it('создаёт скилл в проекте без каталога .claude', async () => {
    const report = await installSkill({ dir: project });

    expect(report.created).toContain('SKILL.md');
    expect(report.created).toContain(join('references', 'errors.md'));
    expect(report.updated).toEqual([]);
    expect(report.unchanged).toEqual([]);
    expect(report.diverged).toEqual([]);
    expect(await readFile(inProject('SKILL.md'), 'utf8')).toContain(
      'name: nestling',
    );
  });

  it('пишет манифест с версией пакета и хэшем каждого файла', async () => {
    const report = await installSkill({ dir: project });
    const written = await manifest();

    expect(written.version).toBe(report.version);
    expect(Object.keys(written.files).sort()).toEqual(
      report.created.map((name) => name.split(/[/\\]/).join('/')).sort(),
    );
    expect(written.files['SKILL.md']).toMatch(/^[\da-f]{64}$/);
  });

  it('второй запуск подряд ничего не пишет', async () => {
    const first = await installSkill({ dir: project });
    const second = await installSkill({ dir: project });

    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.diverged).toEqual([]);
    expect(second.unchanged).toEqual(first.created);
  });

  it('обновляет нетронутую старую копию молча', async () => {
    await installSkill({ dir: project });
    // Прежняя версия того же файла: манифест её признаёт, потому что хэш
    // записан установкой, а не сверкой с источником
    const packaged = await readFile(inProject('SKILL.md'), 'utf8');
    await writeFile(inProject('SKILL.md'), 'stale skill\n');
    await rememberHash('SKILL.md', 'stale skill\n');

    const report = await installSkill({ dir: project });

    expect(report.updated).toEqual(['SKILL.md']);
    expect(report.diverged).toEqual([]);
    expect(await readFile(inProject('SKILL.md'), 'utf8')).toBe(packaged);
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

  it('копию без манифеста сравнивает с источником', async () => {
    await installSkill({ dir: project });
    await writeFile(inProject('SKILL.md'), 'stale skill\n');
    await rm(inProject(MANIFEST_NAME));

    const report = await installSkill({ dir: project });

    expect(report.diverged).toEqual(['SKILL.md']);
    expect(await readFile(inProject('SKILL.md'), 'utf8')).toBe('stale skill\n');
  });

  it('перезаписывает расходящийся файл по force', async () => {
    await installSkill({ dir: project });
    const packaged = await readFile(inProject('SKILL.md'), 'utf8');
    await writeFile(inProject('SKILL.md'), `${packaged}\nMine.\n`);

    const report = await installSkill({ dir: project, force: true });

    expect(report.diverged).toEqual(['SKILL.md']);
    expect(report.forced).toBe(true);
    expect(await readFile(inProject('SKILL.md'), 'utf8')).toBe(packaged);

    const written = await manifest();

    expect(written.files['SKILL.md']).toBeDefined();
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

/** Подменяет хэш файла в манифесте: так выглядит копия прежней версии */
async function rememberHash(name: string, content: string): Promise<void> {
  const { createHash } = await import('node:crypto');
  const current = await manifest();

  current.files[name] = createHash('sha256').update(content).digest('hex');

  await writeFile(
    inProject(MANIFEST_NAME),
    `${JSON.stringify(current, null, 2)}\n`,
  );
}
