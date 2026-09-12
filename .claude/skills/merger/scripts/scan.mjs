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
 *   rebasing worktree без ветки: идёт rebase, HEAD отсоединён на время переигрывания
 *   detached worktree без ветки вне rebase
 *
 * Строки в режиме --watch, одна на событие:
 *   STATE   <ветка> …   снимок при старте, по строке на worktree
 *   READY   <ветка> …   ветка стала готовой к слиянию
 *   MERGED  <ветка>     коммиты ветки оказались в main
 *   FREE    <ветка> …   сессия влитого worktree закрылась (процесса с сокетом
 *                       больше нет): worktree можно убирать
 *   UNLOCKED <ветка> …  с влитого worktree снят лок; запасной признак, bridge
 *                       лок обычно не снимает
 *   NEW     <ветка> …   появился worktree
 *   GONE    <ветка>     worktree исчез
 *   CHANGED <ветка> …   другой переход: ready → working, переименование ветки,
 *                       начало и конец rebase
 *
 * Worktree узнаётся по пути, а не по ветке: rebase и переименование ветки
 * печатаются как CHANGED, а не как GONE и NEW.
 *   ERROR   <текст>     скан не удался, цикл продолжается
 *
 * Поле session — подсказка для ListAgents: имя сессии worktree начинается
 * с имени его папки строчными буквами, где «_» заменён на «-».
 * Поле alive — есть ли в worktree живая сессия: процесс с cwd в нём и
 * сокетом /tmp/cc-socks/<pid>.sock (через lsof).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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

// Живая сессия Claude Code: процесс с cwd в worktree, у которого есть сокет
// /tmp/cc-socks/<pid>.sock — по нему сессия принимает сообщения. Возвращает
// карту cwd → pid[] только для таких процессов.
function liveSessions() {
  let out = '';
  try {
    out = execFileSync('lsof', ['-a', '-d', 'cwd', '-Fpn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    out = typeof err.stdout === 'string' ? err.stdout : '';
  }
  const byCwd = new Map();
  let pid = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = line.slice(1);
    else if (line.startsWith('n') && pid && fs.existsSync(`/tmp/cc-socks/${pid}.sock`)) {
      const cwd = line.slice(1);
      if (!byCwd.has(cwd)) byCwd.set(cwd, []);
      byCwd.get(cwd).push(pid);
    }
  }
  return byCwd;
}

function sessionsIn(byCwd, path) {
  const pids = [];
  for (const [cwd, list] of byCwd) {
    if (cwd === path || cwd.startsWith(path + '/')) pids.push(...list);
  }
  return pids;
}

function listWorktrees(root) {
  const entries = [];
  let current = null;
  for (const line of git(['worktree', 'list', '--porcelain'], root).split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null, locked: false, detached: false };
      entries.push(current);
    } else if (line === 'detached' && current) {
      current.detached = true;
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
  const sessions = liveSessions();
  for (const wt of listWorktrees(root)) {
    if (wt.branch === 'main') continue;
    const alive = sessionsIn(sessions, wt.path).length > 0;
    if (!wt.branch) {
      // Без ветки: идёт rebase (HEAD отсоединён на время переигрывания) или detached HEAD.
      let rebasing = false;
      try {
        rebasing = fs.existsSync(git(['rev-parse', '--git-path', 'rebase-merge'], wt.path))
          || fs.existsSync(git(['rev-parse', '--git-path', 'rebase-apply'], wt.path));
      } catch {
        rebasing = false;
      }
      result.push({
        branch: '(detached)',
        path: wt.path,
        locked: wt.locked,
        alive,
        state: rebasing ? 'rebasing' : 'detached',
        ahead: 0,
        behind: 0,
        dirty: gitLines(['status', '--porcelain'], wt.path).length,
        ffable: null,
        newArchives: [],
        active: [],
        roadmap: null,
        session: basename(wt.path).toLowerCase().replaceAll('_', '-'),
      });
      continue;
    }
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

    // Архивированный change обязан закрыть свою строку roadmap: имя и **done** в одной строке.
    let roadmap = null;
    if (state === 'ready') {
      let rows = [];
      try {
        rows = git(['show', `${b}:docs/decisions/roadmap.md`], root).split('\n');
      } catch {
        rows = [];
      }
      roadmap = newArchives.every((a) => {
        const name = a.replace(/^\d{4}-\d{2}-\d{2}-/, '');
        return rows.some((l) => l.includes(`\`${name}\``) && l.includes('**done**'));
      });
    }

    result.push({
      branch: b,
      path: wt.path,
      locked: wt.locked,
      alive,
      state,
      ahead,
      behind,
      dirty,
      ffable,
      newArchives,
      active,
      roadmap,
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
    `alive=${yesNo(e.alive)}`,
    `archive=${e.newArchives.join(',') || '-'}`,
    `roadmap=${yesNo(e.roadmap)}`,
    `active=${e.active.join(',') || '-'}`,
    `session=${e.session}`,
    `path=${e.path}`,
  ].join(' ');
}

function printTable(entries) {
  const rows = [
    ['state', 'branch', 'ahead/behind', 'dirty', 'ff', 'locked', 'alive', 'archive', 'roadmap', 'session'],
    ...entries.map((e) => [
      e.state,
      e.branch,
      `${e.ahead}/${e.behind}`,
      String(e.dirty),
      yesNo(e.ffable),
      yesNo(e.locked),
      yesNo(e.alive),
      e.newArchives.join(',') || '-',
      yesNo(e.roadmap),
      e.session,
    ]),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd());
}

// Ключ состояния: событие печатается, только когда он меняется.
function stateKey(e) {
  const state = e.state === 'ready' ? `ready:${e.newArchives.join(',')}` : e.state;
  return `${e.branch}|${state}`;
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
    const current = new Map(scan(root).map((e) => [e.path, e]));
    for (const [path, e] of current) {
      const prev = previous.get(path);
      if (first) console.log(`STATE ${describe(e)}`);
      else if (!prev) console.log(`NEW ${describe(e)}`);
      else if (e.state === 'merged' && prev.alive && !e.alive) console.log(`FREE ${describe(e)}`);
      else if (e.state === 'merged' && prev.locked && !e.locked) console.log(`UNLOCKED ${describe(e)}`);
      else if (stateKey(prev) !== stateKey(e)) {
        if (e.state === 'ready') console.log(`READY ${describe(e)}`);
        else if (e.state === 'merged' && prev.state !== 'merged') console.log(`MERGED ${e.branch}`);
        else console.log(`CHANGED ${describe(e)}`);
      }
    }
    for (const [path, prev] of previous) {
      if (!current.has(path)) console.log(`GONE ${prev.branch} path=${path}`);
    }
    previous = current;
    first = false;
  } catch (err) {
    console.log(`ERROR ${String(err.message ?? err).split('\n')[0]}`);
  }
  await sleep(intervalSec * 1000);
}
