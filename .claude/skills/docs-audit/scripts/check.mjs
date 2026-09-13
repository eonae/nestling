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
import { applyToc } from './ideas-toc.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { collectPackageExports } from './package-exports.mjs';
import {
  LANGUAGES,
  PACKAGES_OUTLINE,
  SECTIONS,
  readmeName,
  sourcePath,
} from '../../../../scripts/site/sections.mjs';

const ROOT = process.cwd();
const DOCS = join(ROOT, 'docs');
const EN = join(DOCS, 'en');
const ALLOWED_ROOT_MD = new Set(['README.md', 'README.ru.md', 'CLAUDE.md', 'RELEASING.md']);

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

// ── 1a. Плашка «Target state of V1» в каждом docs/en/design/*.md ────────────
// Английская пара несёт ту же плашку своей формой: аудит ищет её по языку.

for (const f of mdFiles(join(EN, 'design')).filter((f) => f !== 'README.md')) {
  const file = join(EN, 'design', f);
  if (!/\*\*Target state of V1/i.test(head(file))) {
    add('ERROR', 'design-plate', file,
      'нет плашки «**Target state of V1**» в первых 12 строках');
  }
}

// ── 2. Плашка «сверено с кодом» в главах и рецептах + её свежесть ──────────
// Плашку несёт каждый .md обеих папок жанра, кроме их оглавлений
// README.md. Файлов-исключений по имени нет: приложений с буквой не
// существует, а рецепт без примера-источника не заводится. Плашка может
// называть несколько примеров через запятую.

const GUIDE = join(DOCS, 'guide');
const RECIPES = join(DOCS, 'recipes');
const guideFiles = mdFiles(GUIDE).filter((f) => f !== 'README.md');
const recipeFiles = mdFiles(RECIPES).filter((f) => f !== 'README.md');

/** Форма плашки на каждом языке: русская «сверено с кодом», английская «verified against» */
const PLATE = {
  ru: {
    re: /сверено с кодом\s+((?:`[^`]+`\s*,?\s*)+)\((\d{4}-\d{2}-\d{2})\)/i,
    shape: 'сверено с кодом `<пример>` (YYYY-MM-DD)',
  },
  en: {
    re: /verified against\s+((?:`[^`]+`\s*,?\s*)+)\((\d{4}-\d{2}-\d{2})\)/i,
    shape: 'verified against `<example>` (YYYY-MM-DD)',
  },
};

/** Дата плашки по языку: ключ — «жанр/файл», общий для пары */
const plateDates = { ru: new Map(), en: new Map() };

/**
 * Проверяет плашки одного языка и свежесть примеров, на которые они ссылаются.
 *
 * Файл, которого на этом языке нет, пропускается: его отсутствие — забота
 * инварианта `lang-parity`, и второе сообщение о том же было бы шумом.
 */
function checkPlates(entries, lang) {
  for (const [dir, f, genre] of entries) {
    const file = join(dir, f);
    if (!existsSync(file)) continue;

    const m = head(file).match(PLATE[lang].re);
    if (!m) {
      add('ERROR', 'guide-plate', file,
        `нет плашки «${PLATE[lang].shape}» в первых 12 строках`);
      continue;
    }
    const [, examples, checkedAt] = m;
    plateDates[lang].set(`${genre}/${f}`, checkedAt);

    for (const example of [...examples.matchAll(/`([^`]+)`/g)].map((x) => x[1])) {
      // Обычно текст сверен с примером; рецепт про сателлит — с пакетом
      const pkg = [`examples/${example}`, `packages/${example}`]
        .find((p) => existsSync(join(ROOT, p)));
      if (!pkg) {
        add('ERROR', 'guide-example', file,
          `нет ни examples/${example}, ни packages/${example}`);
        continue;
      }
      // Манифест не в счёт: `lerna version` меняет в нём одно поле `version`,
      // и без этого исключения каждый релиз помечал бы устаревшими все главы
      // сразу. Сниппеты сверяются с кодом примера, а не с его манифестом
      const code = [pkg, `:(exclude)${pkg}/package.json`];
      const lastCommit = git('log', '-1', '--format=%cs', '--', ...code);
      if (lastCommit && lastCommit > checkedAt) {
        add('WARN', 'guide-stale', file,
          `пример ${example} менялся ${lastCommit}, глава сверена ${checkedAt} — нужна пересверка`);
      }
      if (git('status', '--porcelain', '--', ...code)) {
        add('WARN', 'guide-stale', file,
          `в ${pkg} есть незакоммиченные изменения — после них пересверь главу`);
      }
    }
  }
}

/** Файлы обеих папок жанра: состав задаёт русский оригинал */
const chapterEntries = (root) => [
  ...guideFiles.map((f) => [join(root, 'guide'), f, 'guide']),
  ...recipeFiles.map((f) => [join(root, 'recipes'), f, 'recipes']),
];

checkPlates(chapterEntries(DOCS), 'ru');
checkPlates(chapterEntries(EN), 'en');

// Перевод отстал от правки — предупреждение: главу догоняют тем же
// change'ом, но правило, которое ломает сборку на дате, останавливало бы
// работу на ровном месте.
for (const [key, checkedAt] of plateDates.en) {
  const original = plateDates.ru.get(key);
  if (original && checkedAt < original) {
    add('WARN', 'lang-stale', join(EN, key),
      `перевод сверен ${checkedAt}, оригинал ${original} — перевод отстал от правки`);
  }
}

// ── 3. Карты полны в обе стороны ─────────────────────────────────────────────
// Главы — оглавление docs/guide/README.md, рецепты — docs/recipes/README.md;
// design-доки — карта в docs/design/README.md. docs/README.md обязан вести
// на оба оглавления.

const readmePath = join(DOCS, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const guideTocPath = join(GUIDE, 'README.md');
const recipesTocPath = join(RECIPES, 'README.md');

/** Проверяет полноту оглавления папки жанра в обе стороны */
function checkToc(dir, tocPath, files, label) {
  if (!existsSync(tocPath)) {
    add('ERROR', 'guide-toc', dir, `нет оглавления ${relative(ROOT, tocPath)}`);
    return;
  }
  const toc = readFileSync(tocPath, 'utf8');
  const listed = new Set(
    [...toc.matchAll(/\]\(\.\/([^)#/]+\.md)/g)].map((m) => m[1]),
  );
  for (const f of files) {
    if (!listed.has(f)) {
      add('ERROR', 'guide-toc', tocPath, `${label}/${f} не упомянут в оглавлении`);
    }
  }
  for (const f of listed) {
    if (!files.includes(f)) {
      add('ERROR', 'guide-toc', tocPath, `ссылка на несуществующий ${label}/${f}`);
    }
  }
  if (!new RegExp(`\\]\\(\\./${label.split('/')[1]}/README\\.md\\)`).test(readme)) {
    add('ERROR', 'readme-table', readmePath,
      `docs/README.md не ссылается на ./${label.split('/')[1]}/README.md`);
  }
}

checkToc(GUIDE, guideTocPath, guideFiles, 'docs/guide');
checkToc(RECIPES, recipesTocPath, recipeFiles, 'docs/recipes');

// Нумерация глав пути сквозная и без пропусков: номер задаёт порядок
// чтения, и пропуск означает, что глава потерялась при переименовании.
const chapterNumbers = guideFiles
  .map((f) => /^(\d+)-/.exec(f))
  .filter(Boolean)
  .map((m) => Number(m[1]))
  .sort((a, b) => a - b);

for (const f of guideFiles) {
  if (!/^\d+-/.test(f)) {
    add('ERROR', 'guide-numbering', join(GUIDE, f),
      'глава пути без номера в имени файла — номер задаёт порядок чтения');
  }
}

chapterNumbers.forEach((number, index) => {
  if (number !== index + 1) {
    add('ERROR', 'guide-numbering', guideTocPath,
      `нумерация глав пути не сквозная: после ${index} идёт ${number}`);
  }
});

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
  recipesTocPath,
  ...recipeFiles.map((f) => join(RECIPES, f)),
  ...['guarantees.md', 'compatibility.md', 'from-nestjs.md']
    .map((f) => join(DOCS, f))
    .filter((f) => existsSync(f)),
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

// ── 7. Реализованный change отмечен в журнале решений ───────────────────────
// Запись ideas.md, по которой сделан change, несёт пометку «РЕАЛИЗОВАНО …
// change `имя`». Проверяются те change'и, чья строка roadmap ссылается на
// журнал: значит запись существует и пометке есть где стоять.

const roadmapPath = join(DOCS, 'decisions', 'roadmap.md');
const ideasPath = join(DOCS, 'decisions', 'ideas.md');

if (existsSync(roadmapPath) && existsSync(ideasPath)) {
  const ideasLines = readFileSync(ideasPath, 'utf8').split('\n');
  const marked = new Set();

  // Имя change'а может уехать на следующую строку переносом — берём окно.
  for (const [i, line] of ideasLines.entries()) {
    if (!line.includes('РЕАЛИЗОВАНО')) continue;
    const window = ideasLines.slice(i, i + 3).join(' ');
    for (const m of window.matchAll(/`([a-z0-9.+-]+)`/g)) marked.add(m[1]);
  }

  for (const line of readFileSync(roadmapPath, 'utf8').split('\n')) {
    const m = /^\| \d+ \| `([a-z0-9.+-]+)` \|/.exec(line);
    if (!m || !line.includes('**done**') || !line.includes('ideas.md')) continue;
    if (!marked.has(m[1])) {
      add('ERROR', 'ideas-implemented', ideasPath,
        `change \`${m[1]}\` сделан, но записи журнала о нём нет пометки РЕАЛИЗОВАНО`);
    }
  }
}

// ── 8b. Оглавление ideas.md совпадает с заголовками записей ──────────────────
// Правило 14 «Правил ведения»: блок между маркерами пишет ideas-toc.mjs.

if (existsSync(ideasPath)) {
  const text = readFileSync(ideasPath, 'utf8');
  if (applyToc(text) !== text) {
    add('ERROR', 'ideas-toc', ideasPath,
      'оглавление устарело или отсутствует — запусти node .claude/skills/docs-audit/scripts/ideas-toc.mjs');
  }
}

// ── 9. README пакетов: структура, потолок, плашка, перечень экспортов ────────
// Правила 10 и 11 «Правил ведения» из docs/README.md. README пакета отвечает
// на вопрос «что в пакете сегодня и как называется»: шесть разделов, потолок
// строк, плашка со ссылками и полный перечень публичных имён. Проверяются оба
// файла пары: английский README.md и русский README.ru.md.

const PACKAGES = join(ROOT, 'packages');

/** Заголовки разделов README на каждом языке: состав и порядок общие */
const README_SECTIONS = {
  ru: ['Установка', 'Минимальный пример', 'Экспорты', 'Границы пакета'],
  en: ['Install', 'Minimal example', 'Exports', 'Package boundaries'],
};

/** Папка документации, в которую ведёт плашка своего языка */
const PLATE_DOCS = { ru: 'docs', en: 'docs/en' };

const README_MAX_LINES = 120;
const EXPORTS_MAX_LINES = 60;
const PLATE_MAX_LINKS = 3;
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Имена в разделе «Экспорты»: первая колонка таблицы и пункты списка групп.
 *
 * Прочая проза раздела не разбирается: иначе идентификатор в поясняющей
 * фразе («бросает `TypeError`») читался бы как имя экспорта.
 */
function readmeExportNames(lines) {
  const names = new Set();
  const take = (text) => {
    for (const m of text.matchAll(/`([^`]+)`/g)) {
      if (IDENT.test(m[1])) names.add(m[1]);
    }
  };
  let inBullet = false;
  for (const raw of lines) {
    if (/^\s*$/.test(raw)) {
      inBullet = false;
      continue;
    }
    const line = raw.trim();
    if (line.startsWith('#')) continue;
    if (line.startsWith('|')) {
      inBullet = false;
      const first = line.split('|')[1] ?? '';
      if (/^\s*:?-{2,}/.test(first)) continue; // разделитель шапки
      take(first);
      continue;
    }
    if (/^[-*] /.test(line)) {
      inBullet = true;
      take(line);
      continue;
    }
    if (inBullet && /^\s{2,}\S/.test(raw)) take(line);
    else inBullet = false;
  }
  return names;
}

const listNames = (set, limit = 12) => {
  const all = [...set].sort();
  return all.length > limit
    ? `${all.slice(0, limit).join(', ')} и ещё ${all.length - limit}`
    : all.join(', ');
};

const packageDirs = existsSync(PACKAGES)
  ? readdirSync(PACKAGES)
      .map((d) => join(PACKAGES, d))
      .filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'package.json')))
      .sort()
  : [];

/**
 * Проверяет один файл пары README: разделы, потолок, плашку и перечень имён.
 *
 * @returns Имена, названные разделом экспортов; у пары они сверяются между собой
 */
function checkReadme(dir, lang, pkg, internal) {
  const file = join(dir, readmeName(lang));
  const sections = README_SECTIONS[lang];

  if (!existsSync(file)) {
    add('ERROR', 'pkg-readme', dir, `нет ${readmeName(lang)}`);
    return new Set();
  }

  const lines = readFileSync(file, 'utf8').split('\n');

  // 9.1 Состав и порядок разделов второго уровня
  const headings = [];
  let fenced = false;
  lines.forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) fenced = !fenced;
    if (fenced) return;
    const m = /^##\s+(.+?)\s*$/.exec(raw);
    if (m) headings.push({ title: m[1], line: i + 1 });
  });
  const titles = headings.map((h) => h.title);
  if (titles.join(' ') !== sections.join(' ')) {
    for (const h of headings) {
      if (!sections.includes(h.title)) {
        add('ERROR', 'pkg-readme-sections', file,
          `строка ${h.line}: лишний раздел «${h.title}» — обучение живёт в docs/guide/ и docs/recipes/, семантика в docs/design/`);
      }
    }
    const known = titles.filter((t) => sections.includes(t));
    if (known.join(' ') !== sections.join(' ')) {
      add('ERROR', 'pkg-readme-sections', file,
        `порядок разделов «${titles.join(', ') || 'разделов нет'}», нужен «${sections.join(', ')}»`);
    }
  }

  // 9.2 Потолок строк
  const length = lines.at(-1) === '' ? lines.length - 1 : lines.length;
  if (length > README_MAX_LINES) {
    add('ERROR', 'pkg-readme-length', file, `${length} строк при потолке ${README_MAX_LINES}`);
  }

  // 9.3 Плашка статуса — блок цитаты за первым абзацем
  const firstHeading = headings[0]?.line ?? lines.length;
  const plateStart = lines.findIndex((l, i) => i < firstHeading && l.startsWith('>'));
  if (plateStart === -1) {
    add('ERROR', 'pkg-readme-plate', file,
      'нет плашки статуса — блока цитаты перед первым разделом');
  } else {
    let plateEnd = plateStart;
    while (plateEnd + 1 < lines.length && lines[plateEnd + 1].startsWith('>')) plateEnd += 1;
    const plate = lines.slice(plateStart, plateEnd + 1);
    const prose = lines.slice(0, plateStart).filter((l) => l.trim() && !l.startsWith('#'));
    if (prose.length === 0) {
      add('ERROR', 'pkg-readme-plate', file, 'плашка статуса стоит раньше абзаца «что это»');
    }
    // Плашка ведёт в папки своего языка: русская в docs/, английская в docs/en/
    const docs = PLATE_DOCS[lang];
    const links = (dirName) =>
      plate.join('\n').match(new RegExp(`\\]\\([^)]*${docs}/${dirName}/[^)]+\\)`, 'g')) ?? [];
    const design = links('design');
    // Ссылки в guide/ и recipes/ — один вид: у пакета один текст-источник,
    // и жанр этого текста выбирает не пакет
    const guide = [...links('guide'), ...links('recipes')];
    if (internal) {
      if (plate.length > 1) {
        add('ERROR', 'pkg-readme-plate', file,
          `плашка внутреннего пакета занимает ${plate.length} строк вместо одной`);
      }
      if (design.length || guide.length) {
        add('ERROR', 'pkg-readme-plate', file,
          'у внутреннего пакета нет ни design-дока, ни главы гайда — ссылки из плашки лишние');
      }
    } else {
      if (!design.length) {
        add('ERROR', 'pkg-readme-plate', file, `в плашке нет ссылки в ${docs}/design/`);
      }
      if (!guide.length) {
        add('ERROR', 'pkg-readme-plate', file,
          `в плашке нет ссылки ни в ${docs}/guide/, ни в ${docs}/recipes/`);
      }
      if (design.length > PLATE_MAX_LINKS) {
        add('ERROR', 'pkg-readme-plate', file,
          `${design.length} ссылок на design-доки при потолке ${PLATE_MAX_LINKS}`);
      }
      if (guide.length > PLATE_MAX_LINKS) {
        add('ERROR', 'pkg-readme-plate', file,
          `${guide.length} ссылок на главы и рецепты при потолке ${PLATE_MAX_LINKS}`);
      }
    }
  }

  // 9.4 Минимальный пример — ровно один блок кода
  const exampleHeading = headings.find((h) => h.title === sections[1]);
  if (exampleHeading) {
    const after = headings[headings.indexOf(exampleHeading) + 1]?.line ?? lines.length + 1;
    const fences = lines
      .slice(exampleHeading.line, after - 1)
      .filter((l) => /^\s*(```|~~~)/.test(l)).length;
    if (fences !== 2) {
      add('ERROR', 'pkg-readme-sections', file,
        `в разделе «${sections[1]}» ${fences / 2} блоков кода вместо одного`);
    }
  }

  // 9.5 Раздел экспортов: бюджет строк и полнота перечня
  const exportsHeading = headings.find((h) => h.title === sections[2]);
  if (!exportsHeading) return new Set();
  const next = headings[headings.indexOf(exportsHeading) + 1]?.line ?? lines.length + 1;
  const section = lines.slice(exportsHeading.line - 1, next - 1);
  while (section.length && !section.at(-1).trim()) section.pop();
  if (section.length > EXPORTS_MAX_LINES) {
    add('ERROR', 'pkg-exports-budget', file,
      `раздел «${sections[2]}» занимает ${section.length} строк при потолке ${EXPORTS_MAX_LINES}`);
  }

  const sectionText = section.join('\n');

  for (const s of pkg.subpaths) {
    if (!s.barrel) {
      add('ERROR', 'pkg-exports', join(dir, 'package.json'),
        `подпуть «${s.key}» из exports не ведёт ни в один файл src`);
      continue;
    }
    if (s.key !== '.' && !sectionText.includes(s.key)) {
      add('ERROR', 'pkg-exports', file, `в разделе «${sections[2]}» нет группы подпути «${s.key}»`);
    }
    for (const m of s.missing) {
      add('ERROR', 'pkg-exports', file, `не разрешён реэкспорт ${m}`);
    }
  }

  if (!pkg.subpaths.some((s) => s.barrel)) {
    // Пакет-инструмент: вместо перечня имён README называет команду.
    for (const command of pkg.bin) {
      if (!sectionText.includes(command)) {
        add('ERROR', 'pkg-exports', file, `в разделе «${sections[2]}» не названа команда ${command}`);
      }
    }
    return new Set();
  }

  const barrelNames = new Set();
  const sources = new Set();
  for (const s of pkg.subpaths) {
    for (const n of s.names) barrelNames.add(n);
    for (const r of s.reexports) sources.add(r);
  }
  for (const source of sources) {
    if (!sectionText.includes(source)) {
      add('ERROR', 'pkg-exports', file,
        `имена реэкспортированы из ${source}, а ссылки на этот пакет в разделе «${sections[2]}» нет`);
    }
  }

  const documented = readmeExportNames(section);
  const missing = new Set([...barrelNames].filter((n) => !documented.has(n)));
  const unknown = new Set([...documented].filter((n) => !barrelNames.has(n)));
  if (missing.size) {
    add('ERROR', 'pkg-exports', file, `нет в README (${missing.size}): ${listNames(missing)}`);
  }
  if (unknown.size) {
    add('ERROR', 'pkg-exports', file, `нет в коде (${unknown.size}): ${listNames(unknown)}`);
  }

  return documented;
}

for (const dir of packageDirs) {
  const { name } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  // Внутренний пакет узнаётся по имени: скоуп у всех общий, а `common.`
  // в имени означает, что пакет ставится вместе с потребителем
  const internal = name.startsWith('@nestlingjs/common.');
  const pkg = collectPackageExports(dir);

  const documented = Object.fromEntries(
    LANGUAGES.map(({ code }) => [code, checkReadme(dir, code, pkg, internal)]),
  );

  // 9.6 Перечни экспортов совпадают у пары: имена не переводятся
  for (const [code, other] of [['en', 'ru'], ['ru', 'en']]) {
    const only = new Set([...documented[code]].filter((n) => !documented[other].has(n)));
    if (only.size) {
      add('ERROR', 'pkg-exports', join(dir, readmeName(other)),
        `имена названы в ${readmeName(code)}, а здесь нет (${only.size}): ${listNames(only)}`);
    }
  }
}

// ── 10. Барели перечисляют имена поимённо ───────────────────────────────────
// Спека packages-layout: файл, названный полем `exports`, состоит из операторов
// `export { … }`. Со специфаером на свой модуль `export *` делает публичной
// каждую его строку, с именем соседнего пакета — прячет состав реэкспорта.
// Пакет без поля `exports` проверку проходит: барреля у него нет.

for (const dir of packageDirs) {
  for (const s of collectPackageExports(dir).subpaths) {
    if (!s.barrel) continue;
    for (const spec of s.stars) {
      add('ERROR', 'pkg-barrel-star', s.barrel,
        `подпуть «${s.key}»: оператор «export * from '${spec}'» — перечислите имена поимённо`);
    }
  }
}

// ── 11. Источники сайта: состав оглавлений и вывод сборки ───────────────────
// Сборка сайта проверяет то же самое, но `docs:audit` запускается без неё и
// без node_modules генератора. Источники читаются из scripts/site/sections.mjs:
// второго списка источников не существует.

const SITE_OUT = join(DOCS, '.site');

/** Ссылки `](./имя.md)` в оглавлении: состав источника-папки */
const listedFiles = (text) =>
  new Set([...text.matchAll(/\]\(\.\/([^)#/]+\.md)/g)].map((m) => m[1]));

for (const source of SECTIONS) {
  const path = join(ROOT, source.path);

  if (source.kind === 'home' || source.kind === 'page') {
    if (!existsSync(path)) {
      add('ERROR', 'site-source', path,
        `источник сайта не найден: sections.mjs называет ${source.path}`);
    }
    continue;
  }

  if (source.kind === 'folder') {
    const tocPath = join(path, 'README.md');
    if (!existsSync(tocPath)) {
      add('ERROR', 'site-source', path, 'нет оглавления README.md');
      continue;
    }
    const listed = listedFiles(readFileSync(tocPath, 'utf8'));
    const files = mdFiles(path).filter((f) => f !== 'README.md');
    for (const f of files) {
      if (!listed.has(f)) {
        add('ERROR', 'site-source', tocPath,
          `${relative(ROOT, join(path, f))} не назван в оглавлении источника`);
      }
    }
    for (const f of listed) {
      if (!files.includes(f)) {
        add('ERROR', 'site-source', tocPath,
          `оглавление называет ${relative(ROOT, join(path, f))}, которого нет`);
      }
    }
    continue;
  }

  if (source.kind === 'packages') {
    const outlinePath = join(ROOT, PACKAGES_OUTLINE);
    const outline = readFileSync(outlinePath, 'utf8');
    const start = outline.indexOf('\n## Пакеты\n');
    const section = start === -1
      ? ''
      : outline.slice(start + 1).split(/\n##\s(?!#)/)[0];
    const listed = new Set(
      [...section.matchAll(/\]\(\.\.\/packages\/([\w.-]+)\/?\)/g)].map((m) => m[1]),
    );
    const dirs = packageDirs.map((d) => relative(PACKAGES, d));

    if (start === -1) {
      add('ERROR', 'site-source', outlinePath, 'нет раздела «## Пакеты»');
    }
    for (const d of dirs) {
      if (!listed.has(d)) {
        add('ERROR', 'site-source', outlinePath,
          `packages/${d} не назван в разделе «Пакеты» — каталог не попадёт в справочник`);
      }
    }
    for (const d of listed) {
      if (!dirs.includes(d)) {
        add('ERROR', 'site-source', outlinePath,
          `раздел «Пакеты» называет packages/${d}, которого нет`);
      }
    }
  }
}

// Вывод сборки — не источник истины: под git он рассинхронизируется с текстом
const tracked = git('ls-files', '--', 'docs/.site');
if (tracked) {
  const files = tracked.split('\n').filter(Boolean);
  add('ERROR', 'site-output', SITE_OUT,
    `вывод сборки отслеживается git (${files.length}): ${files.slice(0, 3).join(', ')}`);
}

// ── 12. Языки: паритет пар, оглавления, ссылки, кириллица, словарь ──────────
// Публикуемый текст существует парой: английский основной, русский парный.
// Состав публикуемого задают источники scripts/site/sections.mjs — паритету
// подлежит ровно то, что попадает на сайт.

/** Путь от корня репозитория через прямые слэши: им сравниваются языки */
const slashed = (file) => relative(ROOT, file).split('\\').join('/');

/** Путь пары на другом языке; `null` — у файла пары не бывает */
function counterpart(file) {
  const rel = slashed(file);

  if (rel.startsWith('docs/en/')) return join(DOCS, rel.slice('docs/en/'.length));
  if (rel.startsWith('docs/')) return join(EN, rel.slice('docs/'.length));
  if (rel === 'README.md') return join(ROOT, 'README.ru.md');
  if (rel === 'README.ru.md') return join(ROOT, 'README.md');

  const pkg = /^(packages\/[^/]+)\/README(\.ru)?\.md$/.exec(rel);
  if (pkg) return join(ROOT, pkg[1], pkg[2] ? 'README.md' : 'README.ru.md');

  return null;
}

/** Публикуемые файлы одного языка: папки жанра, страницы, README пакетов */
function publishedFiles(lang) {
  const files = [];

  for (const source of SECTIONS) {
    const path = join(ROOT, sourcePath(source.path, lang));

    if (source.kind === 'home' || source.kind === 'page') {
      files.push(path);
    } else if (source.kind === 'folder') {
      files.push(join(path, 'README.md'));
      for (const f of mdFiles(path).filter((f) => f !== 'README.md')) {
        files.push(join(path, f));
      }
    } else if (source.kind === 'packages') {
      for (const dir of packageDirs) files.push(join(dir, readmeName(lang)));
    }
  }

  files.push(join(ROOT, lang === 'en' ? 'README.md' : 'README.ru.md'));

  return files;
}

const published = new Map();
for (const { code } of LANGUAGES) {
  for (const file of publishedFiles(code)) published.set(file, code);
}

// 12.1 lang-parity: у публикуемого файла есть пара на другом языке
for (const file of published.keys()) {
  const pair = counterpart(file);
  if (!pair) continue;

  if (!existsSync(file)) {
    add('ERROR', 'lang-parity', file, 'источник сайта назван, но файла нет');
    continue;
  }
  if (!existsSync(pair)) {
    add('ERROR', 'lang-parity', file, `нет пары ${slashed(pair)}`);
  }
}

// 12.2 lang-outline: оглавления пары называют один состав файлов
for (const source of SECTIONS.filter((s) => s.kind === 'folder')) {
  const paths = Object.fromEntries(
    LANGUAGES.map(({ code }) => [
      code,
      join(ROOT, sourcePath(source.path, code), 'README.md'),
    ]),
  );
  if (!existsSync(paths.ru) || !existsSync(paths.en)) continue;

  const listed = Object.fromEntries(
    Object.entries(paths).map(([code, path]) => [
      code,
      new Set(
        [...readFileSync(path, 'utf8').matchAll(/\]\(\.\/([^)#/]+\.md)/g)].map((m) => m[1]),
      ),
    ]),
  );

  for (const [code, other] of [['ru', 'en'], ['en', 'ru']]) {
    for (const f of listed[code]) {
      if (!listed[other].has(f)) {
        add('ERROR', 'lang-outline', paths[other],
          `оглавление ${slashed(paths[code])} называет ${f}, а это — нет`);
      }
    }
  }
}

/** Ссылки строки: относительные адреса без якоря */
function linksOf(raw, file) {
  const found = [];

  for (const m of raw.replace(/`[^`]*`/g, '').matchAll(/\]\((\.{1,2}\/[^)\s]+?)\)/g)) {
    const target = decodeURI(m[1].split('#')[0]);
    if (target) found.push({ text: m[1], abs: resolve(dirname(file), target).replace(/\/$/, '') });
  }

  return found;
}

/**
 * Строка-переключатель языка: она ведёт в пару этого же файла.
 *
 * Переключателю положено пересекать границу языка — в этом его работа, — и
 * подпись на нём пишется языком, в который он ведёт. Такая строка выходит
 * из-под `lang-link` и `lang-cyrillic`; корневые README связаны ею.
 */
const isLanguageSwitch = (raw, file) => {
  const pair = counterpart(file);

  return Boolean(pair) && linksOf(raw, file).some((link) => link.abs === pair);
};

// 12.3 lang-link: ссылка не пересекает границу языка
// Ссылка в непубликуемый файл остаётся относительной в обоих языках:
// генератор переписывает её в адрес GitHub при сборке.
for (const [file, lang] of published) {
  if (!existsSync(file)) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  let inFence = false;

  lines.forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence || isLanguageSwitch(raw, file)) return;

    for (const link of linksOf(raw, file)) {
      const other = published.get(link.abs);
      if (other && other !== lang) {
        const where = other === 'ru' ? 'русский' : 'английский';
        add('ERROR', 'lang-link', file,
          `строка ${i + 1}: ссылка ${link.text} ведёт в ${where} файл`);
      }
    }
  });
}

// 12.4 lang-cyrillic: английский текст написан по-английски
// Блоки кода и инлайн-код не считаются: в них лежат идентификаторы, а в
// словаре — русские оригиналы терминов.
for (const [file, lang] of published) {
  if (lang !== 'en' || !existsSync(file)) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  let inFence = false;

  lines.forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence || isLanguageSwitch(raw, file)) return;

    const m = raw.replace(/`[^`]*`/g, '').match(/[\u0400-\u04FF]+/);
    if (m) {
      add('ERROR', 'lang-cyrillic', file,
        `строка ${i + 1}: кириллица вне блока кода — «${m[0]}»`);
    }
  });
}

// 12.5 lang-glossary: термин русского глоссария назван в английском
// Английский глоссарий служит словарём перевода: у каждого термина в нём
// стоит русский оригинал, и по нему главы называют понятия одинаково.

const glossaryRu = join(DOCS, 'glossary.md');
const glossaryEn = join(EN, 'glossary.md');

if (existsSync(glossaryRu) && existsSync(glossaryEn)) {
  /** Имя термина без кавычек, уточнения в скобках и регистра */
  const normalize = (term) =>
    term
      .replace(/`/g, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const source = readFileSync(glossaryRu, 'utf8');
  const terms = new Set();

  for (const m of source.matchAll(/^- \*\*(.+?)\*\*/gm)) terms.add(normalize(m[1]));

  // Таблица «Как пишем термины»: первая колонка называет то, чем пишем
  const table =
    source.split('<!-- docs-style: off -->')[1]?.split('<!-- docs-style: on -->')[0] ?? '';
  for (const line of table.split('\n')) {
    const cell = /^\|\s*([^|]+?)\s*\|/.exec(line);
    if (cell && !/^:?-{2,}/.test(cell[1])) terms.add(normalize(cell[1]));
  }
  terms.delete('пишем');

  const translated = readFileSync(glossaryEn, 'utf8').replace(/`/g, '').toLowerCase();
  for (const term of [...terms].sort()) {
    if (term && !translated.includes(term)) {
      add('ERROR', 'lang-glossary', glossaryEn,
        `термин «${term}» назван в docs/glossary.md, а здесь его нет`);
    }
  }
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
