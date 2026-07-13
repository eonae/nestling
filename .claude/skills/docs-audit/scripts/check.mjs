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

// ── 1. Плашка статуса в каждом design/*.md ──────────────────────────────────

const designFiles = mdFiles(join(DOCS, 'design'));
for (const f of designFiles) {
  const file = join(DOCS, 'design', f);
  if (!/\*\*Статус:?/i.test(head(file))) {
    add('ERROR', 'design-plate', file, 'нет плашки «**Статус:**» в первых 12 строках');
  }
}

// ── 2. Плашка «сверено с кодом» в guides/*.md + её свежесть ─────────────────

const guideFiles = mdFiles(join(DOCS, 'guides'));
for (const f of guideFiles) {
  const file = join(DOCS, 'guides', f);
  const m = head(file).match(/сверено с кодом\s+`([^`]+)`\s*\((\d{4}-\d{2}-\d{2})\)/i);
  if (!m) {
    add('ERROR', 'guide-plate', file,
      'нет плашки «сверено с кодом `<пример>` (YYYY-MM-DD)» в первых 12 строках');
    continue;
  }
  const [, example, checkedAt] = m;
  const pkg = `packages/${example}`;
  if (!existsSync(join(ROOT, pkg))) {
    add('ERROR', 'guide-example', file, `пример ${pkg} не существует`);
    continue;
  }
  const lastCommit = git('log', '-1', '--format=%cs', '--', pkg);
  if (lastCommit && lastCommit > checkedAt) {
    add('WARN', 'guide-stale', file,
      `пример ${example} менялся ${lastCommit}, гайд сверен ${checkedAt} — нужна пересверка`);
  }
  if (git('status', '--porcelain', '--', pkg)) {
    add('WARN', 'guide-stale', file,
      `в ${pkg} есть незакоммиченные изменения — после них пересверь гайд`);
  }
}

// ── 3. Таблицы docs/README.md полны в обе стороны ───────────────────────────

const readmePath = join(DOCS, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
for (const [dir, files] of [['design', designFiles], ['guides', guideFiles]]) {
  const listed = new Set(
    [...readme.matchAll(new RegExp(`\\]\\(\\./${dir}/([^)#]+\\.md)`, 'g'))].map((m) => m[1]),
  );
  for (const f of files) {
    if (!listed.has(f)) {
      add('ERROR', 'readme-table', readmePath, `docs/${dir}/${f} не упомянут в docs/README.md`);
    }
  }
  for (const f of listed) {
    if (!files.includes(f)) {
      add('ERROR', 'readme-table', readmePath, `ссылка на несуществующий docs/${dir}/${f}`);
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
  ...designFiles.map((f) => join(DOCS, 'design', f)),
  ...guideFiles.map((f) => join(DOCS, 'guides', f)),
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

// ── 7. Нумерация history/discussions/NN-* ───────────────────────────────────

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
