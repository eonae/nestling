/**
 * Удалённые публичные имена: что экспортировалось на теге выпуска и на `HEAD`
 * больше не экспортируется.
 *
 * База сравнения — объединение имён по всем тегам `v*`, а не последний тег.
 * Выпуск переносит тег вперёд, и разность с одним только последним тегом
 * пуста ровно после того выпуска, чьи удаления и надо ловить.
 *
 * Дерево тега раскладывается `git archive` во временный каталог и читается тем
 * же разбором барелей, каким читается рабочее дерево (`package-exports.mjs`).
 * Рабочий каталог не переключается, рабочее дерево не трогается. Имена тега
 * кэшируются по SHA его коммита: тег неизменяем, и промах кэша бывает один раз
 * на тег.
 *
 * Множество удалённых имён:
 *   node .claude/skills/docs-audit/scripts/tag-names.mjs
 * Самопроверка на временном репозитории с двумя тегами:
 *   node .claude/skills/docs-audit/scripts/tag-names.mjs --self-test
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { allNames, collectPackageExports } from './package-exports.mjs';

/**
 * Версия разбора в имени файла кэша.
 *
 * Правила чтения барелей меняются вместе с `package-exports.mjs`, а SHA тега
 * от этого не меняется. Номер выше — прежние файлы кэша просто перестают
 * попадаться.
 */
const CACHE_VERSION = 1;

const git = (repoRoot, args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();

/** Теги выпуска: имя начинается с `v`. Порядок не важен — имена объединяются. */
export function releaseTags(repoRoot) {
  const out = git(repoRoot, ['tag', '--list', 'v*']);
  return out ? out.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

/**
 * Публичные имена всех пакетов дерева, лежащего на диске.
 *
 * Приватный пакет пропускается: его имена не видит никто, кроме репозитория.
 *
 * @param {string} treeRoot корень дерева — рабочего или разложенного из тега
 * @returns {Set<string>}
 */
export function treeNames(treeRoot) {
  const packages = join(treeRoot, 'packages');
  const names = new Set();
  if (!existsSync(packages)) return names;

  for (const entry of readdirSync(packages).sort()) {
    const pkgDir = join(packages, entry);
    if (!statSync(pkgDir).isDirectory()) continue;
    const manifest = join(pkgDir, 'package.json');
    if (!existsSync(manifest)) continue;
    if (JSON.parse(readFileSync(manifest, 'utf8')).private) continue;

    for (const name of allNames(collectPackageExports(pkgDir))) names.add(name);
  }

  return names;
}

function readCache(file) {
  try {
    return new Set(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null; // битый файл кэша равносилен его отсутствию
  }
}

function writeCache(file, names) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify([...names].sort()));
  } catch {
    // Кэш необязателен: без него проверка идёт полным разбором.
  }
}

/** Публичные имена одного тега. Дерево тега берётся с диска, ответ — из кэша. */
export function tagNames(repoRoot, tag) {
  const sha = git(repoRoot, ['rev-list', '-n', '1', tag]);
  const cacheFile = join(
    repoRoot,
    'node_modules/.cache/docs-audit',
    `tag-names-${CACHE_VERSION}-${sha}.json`,
  );

  const cached = existsSync(cacheFile) ? readCache(cacheFile) : null;
  if (cached) return cached;

  const dir = mkdtempSync(join(tmpdir(), 'docs-audit-tag-'));
  try {
    const tar = join(dir, 'tree.tar');
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha, 'packages'], { cwd: repoRoot });
    execFileSync('tar', ['-x', '-f', tar, '-C', dir]);

    const names = treeNames(dir);
    writeCache(cacheFile, names);
    return names;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Имена, которые тег выпуска экспортировал, а рабочее дерево уже нет.
 *
 * @param {string} repoRoot корень репозитория
 * @returns {{ tags: string[], names: Set<string> | null }} `names` равно `null`,
 *   когда тегов выпуска нет: сравнивать не с чем, и пустое множество сказало бы
 *   об этом неправду
 */
export function deletedNames(repoRoot) {
  const tags = releaseTags(repoRoot);
  if (!tags.length) return { tags, names: null };

  const released = new Set();
  for (const tag of tags) for (const name of tagNames(repoRoot, tag)) released.add(name);

  const live = treeNames(repoRoot);
  return { tags, names: new Set([...released].filter((name) => !live.has(name))) };
}

// ── Запуск из командной строки ───────────────────────────────────────────────

/** Пакет фикстуры: барель с перечнем имён и поле `exports` на него. */
function writeFixture(repoRoot, dir, { name, private: isPrivate, names }) {
  const src = join(repoRoot, 'packages', dir, 'src');
  mkdirSync(src, { recursive: true });
  writeFileSync(
    join(repoRoot, 'packages', dir, 'package.json'),
    JSON.stringify({ name, ...(isPrivate ? { private: true } : {}), exports: { '.': './dist/index.js' } }),
  );
  writeFileSync(join(src, 'index.ts'), names.map((n) => `export const ${n} = 1;\n`).join(''));
}

/**
 * Самопроверка на временном репозитории: имя удалено и имя вернулось.
 *
 * Оба случая в настоящем репозитории не воспроизвести — теги там неизменяемы,
 * а история удаления конкретного имени со временем уезжает.
 *
 * @returns {string[]} описания расхождений, пустой массив — случаи пройдены
 */
function selfTestFailures() {
  const repo = mkdtempSync(join(tmpdir(), 'tag-names-repo-'));
  const run = (...args) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: repo,
      stdio: 'ignore',
    });
  try {
    run('init', '-q');

    const commit = (state, tag) => {
      rmSync(join(repo, 'packages'), { recursive: true, force: true });
      for (const fixture of state) writeFixture(repo, fixture.dir, fixture);
      run('add', '-A');
      run('commit', '-q', '-m', tag ?? 'head');
      if (tag) run('tag', tag);
    };

    const pkg = (names) => ({ dir: 'one', name: '@fixture/one', names });
    const hidden = (names) => ({ dir: 'two', name: '@fixture/two', private: true, names });

    commit([pkg(['gone', 'returning']), hidden(['secret'])], 'v0.1.0');
    commit([pkg(['gone']), hidden([])], 'v0.2.0');
    commit([pkg(['returning', 'fresh'])]);

    const { tags, names } = deletedNames(repo);
    const failures = [];
    if (tags.join(', ') !== 'v0.1.0, v0.2.0') failures.push(`теги ${JSON.stringify(tags)}`);
    if (!names.has('gone')) failures.push('удалённое имя gone не найдено');
    if (names.has('returning')) failures.push('вернувшееся имя returning названо удалённым');
    if (names.has('fresh')) failures.push('новое имя fresh названо удалённым');
    if (names.has('secret')) failures.push('имя приватного пакета secret попало в множество');
    return failures;
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  if (process.argv.includes('--self-test')) {
    const failures = selfTestFailures();
    if (failures.length) {
      for (const f of failures) console.error(`FAIL ${f}`);
      process.exit(1);
    }
    console.log('Самопроверка пройдена.');
    process.exit(0);
  }

  const { tags, names } = deletedNames(process.cwd());
  if (!names) {
    console.log('Тегов выпуска нет: сравнивать не с чем.');
    process.exit(0);
  }
  console.log(`Теги (${tags.length}): ${tags.join(', ')}`);
  console.log(`Удалённых имён ${names.size}:`);
  for (const name of [...names].sort()) console.log(`  ${name}`);
}
