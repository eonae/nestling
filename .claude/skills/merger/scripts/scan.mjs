#!/usr/bin/env node
/**
 * Обход worktree репозитория: какая ветка готова к слиянию в main.
 *
 * Запуск из главного worktree (ветка main):
 *   node .claude/skills/merger/scripts/scan.mjs            таблица по всем worktree
 *   node .claude/skills/merger/scripts/scan.mjs --json     то же в JSON
 *   node .claude/skills/merger/scripts/scan.mjs --watch    цикл: строка на каждое
 *                                                          изменение состояния
 *   --interval <сек>                                       период цикла, по умолчанию 60
 *
 * Состояния ветки:
 *   ready    в ветке есть архив change'а, которого нет в main; worktree чистый;
 *            в ветке есть коммиты, которых нет в main
 *   merged   все коммиты ветки уже в main
 *   working  ветка в работе: архива нет или worktree грязный
 *
 * Строки в режиме --watch, одна на событие:
 *   STATE   <ветка> …   снимок при старте, по строке на worktree
 *   READY   <ветка> …   ветка стала готовой к слиянию
 *   MERGED  <ветка>     коммиты ветки оказались в main
 *   NEW     <ветка> …   появился worktree
 *   GONE    <ветка>     worktree исчез
 *   CHANGED <ветка> …   другой переход, например ready → working
 *   ERROR   <текст>     скан не удался, цикл продолжается
 *
 * Поле session — подсказка для ListAgents: имя сессии worktree начинается
 * с имени его папки строчными буквами, где «_» заменён на «-».
 */
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const asJson = args.includes('--json');
const intervalIdx = args.indexOf('--interval');
const intervalSec = intervalIdx >= 0 ? Number(args[intervalIdx + 1]) : 60;

function git(argv, cwd) {
  return execFileSync('git', argv, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function gitOk(argv, cwd) {
  try {
    git(argv, cwd);
    return true;
  } catch {
    return false;
  }
}

function gitLines(argv, cwd) {
  try {
    const out = git(argv, cwd);
    return out ? out.split('\n') : [];
  } catch {
    return [];
  }
}

function listWorktrees(root) {
  const entries = [];
  let current = null;
  for (const line of git(['worktree', 'list', '--porcelain'], root).split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null, locked: false };
      entries.push(current);
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line.startsWith('locked') && current) {
      current.locked = true;
    }
  }
  return entries;
}

function scan(root) {
  const archivesInMain = new Set(
    gitLines(['ls-tree', '--name-only', 'main:openspec/changes/archive'], root),
  );
  const result = [];
  for (const wt of listWorktrees(root)) {
    if (!wt.branch || wt.branch === 'main') continue;
    const b = wt.branch;
    const dirty = gitLines(['status', '--porcelain'], wt.path).length;
    const ahead = Number(git(['rev-list', '--count', `main..${b}`], root));
    const behind = Number(git(['rev-list', '--count', `${b}..main`], root));
    const ffable = gitOk(['merge-base', '--is-ancestor', 'main', b], root);
    const newArchives = gitLines(['ls-tree', '--name-only', `${b}:openspec/changes/archive`], root)
      .map((p) => basename(p))
      .filter((name) => !archivesInMain.has(name));
    const active = gitLines(['ls-tree', '--name-only', `${b}:openspec/changes`], root)
      .map((p) => basename(p))
      .filter((name) => name !== 'archive');
    let state = 'working';
    if (ahead === 0) state = 'merged';
    else if (newArchives.length > 0 && dirty === 0) state = 'ready';

    // Архивированный change обязан оставить абзац в archlog.md.
    let archlog = null;
    if (state === 'ready') {
      let text = '';
      try {
        text = git(['show', `${b}:docs/decisions/archlog.md`], root);
      } catch {
        text = '';
      }
      archlog = newArchives.every((a) => text.includes(a.replace(/^\d{4}-\d{2}-\d{2}-/, '')));
    }

    result.push({
      branch: b,
      path: wt.path,
      locked: wt.locked,
      state,
      ahead,
      behind,
      dirty,
      ffable,
      newArchives,
      active,
      archlog,
      session: basename(wt.path).toLowerCase().replaceAll('_', '-'),
    });
  }
  return result;
}

function yesNo(v) {
  return v === null ? '-' : v ? 'yes' : 'no';
}

function describe(e) {
  return [
    e.branch,
    `state=${e.state}`,
    `ahead=${e.ahead}`,
    `behind=${e.behind}`,
    `dirty=${e.dirty}`,
    `ff=${yesNo(e.ffable)}`,
    `locked=${yesNo(e.locked)}`,
    `archive=${e.newArchives.join(',') || '-'}`,
    `archlog=${yesNo(e.archlog)}`,
    `active=${e.active.join(',') || '-'}`,
    `session=${e.session}`,
    `path=${e.path}`,
  ].join(' ');
}

function printTable(entries) {
  const rows = [
    ['state', 'branch', 'ahead/behind', 'dirty', 'ff', 'locked', 'archive', 'archlog', 'session'],
    ...entries.map((e) => [
      e.state,
      e.branch,
      `${e.ahead}/${e.behind}`,
      String(e.dirty),
      yesNo(e.ffable),
      yesNo(e.locked),
      e.newArchives.join(',') || '-',
      yesNo(e.archlog),
      e.session,
    ]),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd());
}

// Ключ состояния: событие печатается, только когда он меняется.
function stateKey(e) {
  return e.state === 'ready' ? `ready:${e.newArchives.join(',')}` : e.state;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const root = git(['rev-parse', '--show-toplevel'], process.cwd());

if (!watch) {
  const entries = scan(root);
  if (asJson) console.log(JSON.stringify(entries, null, 2));
  else printTable(entries);
  process.exit(0);
}

let previous = new Map();
let first = true;
for (;;) {
  try {
    const current = new Map(scan(root).map((e) => [e.branch, e]));
    for (const [branch, e] of current) {
      const prev = previous.get(branch);
      if (first) console.log(`STATE ${describe(e)}`);
      else if (!prev) console.log(`NEW ${describe(e)}`);
      else if (stateKey(prev) !== stateKey(e)) {
        if (e.state === 'ready') console.log(`READY ${describe(e)}`);
        else if (e.state === 'merged') console.log(`MERGED ${branch}`);
        else console.log(`CHANGED ${describe(e)}`);
      }
    }
    for (const branch of previous.keys()) {
      if (!current.has(branch)) console.log(`GONE ${branch}`);
    }
    previous = current;
    first = false;
  } catch (err) {
    console.log(`ERROR ${String(err.message ?? err).split('\n')[0]}`);
  }
  await sleep(intervalSec * 1000);
}
