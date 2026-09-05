#!/usr/bin/env node
/**
 * Механические проверки консистентности docs/ — слой 1 скилла docs-audit.
 * Инварианты взяты из docs/README.md («Правила ведения») и CLAUDE.md.
 *
 * Запуск из корня репозитория:
 *   node .claude/skills/docs-audit/scripts/check.mjs [--json]
 *
 * Exit code: 0 — нет ERROR (WARN допустимы), 1 — есть ERROR, 2 — неверное окружение.
 * Скрипт самодостаточен (только node + git) — можно вешать на pre-commit/CI.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const DOCS = join(ROOT, 'docs');
const ALLOWED_ROOT_MD = new Set(['README.md', 'README.ru.md', 'CLAUDE.md']);

if (!existsSync(DOCS) || !existsSync(join(ROOT, '.git'))) {
  console.error('Запускайте из корня репозитория (не найдены docs/ или .git).');
  process.exit(2);
}

const findings = [];
const add = (severity, category, file, message) =>
  findings.push({ severity, category, file: relative(ROOT, file), message });

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function existsInHead(path) {
  try {
    execFileSync('git', ['cat-file', '-e', `HEAD:${path}`], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const mdFiles = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [];

// Первые строки файла одной строкой — плашки могут переноситься.
const head = (file, n = 12) =>
  readFileSync(file, 'utf8').split('\n').slice(0, n).join(' ');

// ── 1. Плашка «Целевое состояние V1» в каждом design/*.md (кроме README) ────
// В design/ нет статусов реализации: старая плашка «**Статус:**» — тоже ошибка.

const designFiles = mdFiles(join(DOCS, 'design'));
for (const f of designFiles.filter((f) => f !== 'README.md')) {
  const file = join(DOCS, 'design', f);
  if (!/\*\*Целевое состояние V1/i.test(head(file))) {
    add('ERROR', 'design-plate', file,
      'нет плашки «**Целевое состояние V1**» в первых 12 строках');
  }
  if (/\*\*Статус:?/i.test(head(file))) {
    add('ERROR', 'design-plate', file,
      'плашка «**Статус:**» в design/ запрещена — статусы реализации живут в roadmap');
  }
}

// ── 2. Плашка «сверено с кодом» в главах guide/*.md + её свежесть ───────────
// Главы гайда — все .md в docs/guide/, кроме оглавления README.md и
// приложений appendix-*.md: у приложений нет примера-источника. Плашка
// может называть несколько примеров через запятую.

const GUIDE = join(DOCS, 'guide');
const guideFiles = mdFiles(GUIDE).filter((f) => f !== 'README.md');
const chapterFiles = guideFiles.filter((f) => !f.startsWith('appendix-'));
for (const f of chapterFiles) {
  const file = join(GUIDE, f);
  const m = head(file).match(/сверено с кодом\s+((?:`[^`]+`\s*,?\s*)+)\((\d{4}-\d{2}-\d{2})\)/i);
  if (!m) {
    add('ERROR', 'guide-plate', file,
      'нет плашки «сверено с кодом `<пример>` (YYYY-MM-DD)» в первых 12 строках');
    continue;
  }
  const [, examples, checkedAt] = m;
  for (const example of [...examples.matchAll(/`([^`]+)`/g)].map((x) => x[1])) {
    const pkg = `packages/${example}`;
    if (!existsSync(join(ROOT, pkg))) {
      add('ERROR', 'guide-example', file, `пример ${pkg} не существует`);
      continue;
    }
    const lastCommit = git('log', '-1', '--format=%cs', '--', pkg);
    if (lastCommit && lastCommit > checkedAt) {
      add('WARN', 'guide-stale', file,
        `пример ${example} менялся ${lastCommit}, глава сверена ${checkedAt} — нужна пересверка`);
    }
    if (git('status', '--porcelain', '--', pkg)) {
      add('WARN', 'guide-stale', file,
        `в ${pkg} есть незакоммиченные изменения — после них пересверь главу`);
    }
  }
}

// ── 3. Карты полны в обе стороны ─────────────────────────────────────────────
// Главы — оглавление docs/guide/README.md; design-доки — карта в
// docs/design/README.md. docs/README.md обязан вести на оглавление гайда.

const readmePath = join(DOCS, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const guideTocPath = join(GUIDE, 'README.md');
if (!existsSync(guideTocPath)) {
  add('ERROR', 'guide-toc', GUIDE, 'нет оглавления docs/guide/README.md');
} else {
  const toc = readFileSync(guideTocPath, 'utf8');
  const listed = new Set(
    [...toc.matchAll(/\]\(\.\/([^)#/]+\.md)/g)].map((m) => m[1]),
  );
  for (const f of guideFiles) {
    if (!listed.has(f)) {
      add('ERROR', 'guide-toc', guideTocPath, `docs/guide/${f} не упомянут в оглавлении`);
    }
  }
  for (const f of listed) {
    if (!guideFiles.includes(f)) {
      add('ERROR', 'guide-toc', guideTocPath, `ссылка на несуществующий docs/guide/${f}`);
    }
  }
  if (!/\]\(\.\/guide\/README\.md\)/.test(readme)) {
    add('ERROR', 'readme-table', readmePath, 'docs/README.md не ссылается на ./guide/README.md');
  }
}

const designMapPath = join(DOCS, 'design', 'README.md');
if (!existsSync(designMapPath)) {
  add('ERROR', 'design-map', join(DOCS, 'design'), 'нет карты docs/design/README.md');
} else {
  const designMap = readFileSync(designMapPath, 'utf8');
  const listed = new Set(
    [...designMap.matchAll(/\]\(\.\/([^)#/]+\.md)/g)].map((m) => m[1]),
  );
  for (const f of designFiles.filter((f) => f !== 'README.md')) {
    if (!listed.has(f)) {
      add('ERROR', 'design-map', designMapPath,
        `docs/design/${f} не упомянут в карте design/README.md`);
    }
  }
  for (const f of listed) {
    if (!designFiles.includes(f)) {
      add('ERROR', 'design-map', designMapPath, `ссылка на несуществующий docs/design/${f}`);
    }
  }
}

// ── 4. Относительные ссылки резолвятся (кроме history/ — там не чиним) ──────

function scanLinks(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let inFence = false;
  lines.forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const line = raw.replace(/`[^`]*`/g, ''); // инлайн-код не парсим
    for (const m of line.matchAll(/\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = decodeURI(target.split('#')[0]);
      if (!path) continue;
      if (!existsSync(resolve(dirname(file), path))) {
        add('ERROR', 'broken-link', file, `строка ${i + 1}: битая ссылка ${target}`);
      }
    }
  });
}

for (const file of [
  readmePath,
  join(DOCS, 'glossary.md'),
  ...designFiles.map((f) => join(DOCS, 'design', f)),
  guideTocPath,
  ...guideFiles.map((f) => join(GUIDE, f)),
  ...mdFiles(join(DOCS, 'decisions')).map((f) => join(DOCS, 'decisions', f)),
]) {
  scanLinks(file);
}

// ── 5. history/ immutable: незакоммиченные правки замороженных файлов ───────

for (const line of git('status', '--porcelain', '--', 'docs/history').split('\n').filter(Boolean)) {
  let p = line.slice(3);
  if (p.includes(' -> ')) p = p.split(' -> ')[0];
  p = p.replace(/^"|"$/g, '');
  if (existsInHead(p)) {
    add('ERROR', 'history-immutable', join(ROOT, p),
      `docs/history/ заморожен, а файл изменён/переименован/удалён (git status «${line.slice(0, 2).trim()}»)`);
  }
}

// ── 6. Корень репозитория закрыт для документации ───────────────────────────

for (const f of readdirSync(ROOT).filter((f) => f.endsWith('.md'))) {
  if (!ALLOWED_ROOT_MD.has(f)) {
    add('ERROR', 'root-md', join(ROOT, f), 'документация в корне закрыта — перенеси в docs/');
  }
}

// ── 7. Сайт документации не отслеживается git ───────────────────────────────
// docs/.site/ — результат `yarn docs:build`. Файл оттуда в индексе означает,
// что сборку закоммитили: дальше каждая правка главы даёт второй дифф.

for (const p of git('ls-files', '--', 'docs/.site').split('\n').filter(Boolean)) {
  add('ERROR', 'site-tracked', join(ROOT, p),
    'сгенерированный сайт не отслеживается git — убери из индекса (`git rm --cached`)');
}

// ── 8. Нумерация history/discussions/NN-* ───────────────────────────────────

const discDir = join(DOCS, 'history', 'discussions');
const discFiles = mdFiles(discDir);
const nums = [...new Set(
  discFiles.filter((f) => /^\d{2}-/.test(f)).map((f) => Number(f.slice(0, 2))),
)].sort((a, b) => a - b);
for (let n = nums[0] ?? 0; n < (nums.at(-1) ?? 0); n++) {
  if (!nums.includes(n)) {
    add('WARN', 'discussions-numbering', discDir, `пропущен номер ${String(n).padStart(2, '0')}`);
  }
}
for (const f of discFiles.filter((f) => !/^\d{2}-/.test(f))) {
  add('WARN', 'discussions-numbering', join(discDir, f), 'файл без префикса NN-');
}

// ── Вывод ────────────────────────────────────────────────────────────────────

const errors = findings.filter((f) => f.severity === 'ERROR');
const warns = findings.filter((f) => f.severity === 'WARN');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  for (const f of [...errors, ...warns]) {
    console.log(`${f.severity} [${f.category}] ${f.file} — ${f.message}`);
  }
  console.log(`${findings.length ? '\n' : ''}Итог: ${errors.length} ERROR, ${warns.length} WARN.`);
}
process.exit(errors.length ? 1 : 0);
