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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { collectPackageExports } from './package-exports.mjs';

const ROOT = process.cwd();
const DOCS = join(ROOT, 'docs');
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

// ── 2. Плашка «сверено с кодом» в главах и рецептах + её свежесть ──────────
// Плашку несёт каждый .md обеих папок жанра, кроме их оглавлений
// README.md. Файлов-исключений по имени нет: приложений с буквой не
// существует, а рецепт без примера-источника не заводится. Плашка может
// называть несколько примеров через запятую.

const GUIDE = join(DOCS, 'guide');
const RECIPES = join(DOCS, 'recipes');
const guideFiles = mdFiles(GUIDE).filter((f) => f !== 'README.md');
const recipeFiles = mdFiles(RECIPES).filter((f) => f !== 'README.md');

/** Файлы обеих папок жанра парами «папка, имя файла» */
const chapterFiles = [
  ...guideFiles.map((f) => [GUIDE, f]),
  ...recipeFiles.map((f) => [RECIPES, f]),
];

for (const [dir, f] of chapterFiles) {
  const file = join(dir, f);
  const m = head(file).match(/сверено с кодом\s+((?:`[^`]+`\s*,?\s*)+)\((\d{4}-\d{2}-\d{2})\)/i);
  if (!m) {
    add('ERROR', 'guide-plate', file,
      'нет плашки «сверено с кодом `<пример>` (YYYY-MM-DD)» в первых 12 строках');
    continue;
  }
  const [, examples, checkedAt] = m;
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
  ...['guarantees.md', 'from-nestjs.md']
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

// ── 9. README пакетов: структура, потолок, плашка, перечень экспортов ────────
// Правила 10 и 11 «Правил ведения» из docs/README.md. README пакета отвечает
// на вопрос «что в пакете сегодня и как называется»: шесть разделов, потолок
// строк, плашка со ссылками и полный перечень публичных имён.

const PACKAGES = join(ROOT, 'packages');
const README_SECTIONS = ['Установка', 'Минимальный пример', 'Экспорты', 'Границы пакета'];
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

for (const dir of packageDirs) {
  const file = join(dir, 'README.md');
  if (!existsSync(file)) {
    add('ERROR', 'pkg-readme', dir, 'нет README.md');
    continue;
  }
  const lines = readFileSync(file, 'utf8').split('\n');
  const { name } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  // Внутренний пакет узнаётся по имени: скоуп у всех общий, а `common.`
  // в имени означает, что пакет ставится вместе с потребителем
  const internal = name.startsWith('@nestlingjs/common.');

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
  if (titles.join(' ') !== README_SECTIONS.join(' ')) {
    for (const h of headings) {
      if (!README_SECTIONS.includes(h.title)) {
        add('ERROR', 'pkg-readme-sections', file,
          `строка ${h.line}: лишний раздел «${h.title}» — обучение живёт в docs/guide/ и docs/recipes/, семантика в docs/design/`);
      }
    }
    const known = titles.filter((t) => README_SECTIONS.includes(t));
    if (known.join(' ') !== README_SECTIONS.join(' ')) {
      add('ERROR', 'pkg-readme-sections', file,
        `порядок разделов «${titles.join(', ') || 'разделов нет'}», нужен «${README_SECTIONS.join(', ')}»`);
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
    const links = (dirName) =>
      plate.join('\n').match(new RegExp(`\\]\\([^)]*docs/${dirName}/[^)]+\\)`, 'g')) ?? [];
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
        add('ERROR', 'pkg-readme-plate', file, 'в плашке нет ссылки в docs/design/');
      }
      if (!guide.length) {
        add('ERROR', 'pkg-readme-plate', file,
          'в плашке нет ссылки ни в docs/guide/, ни в docs/recipes/');
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

  // 9.4 «Минимальный пример» — ровно один блок кода
  const exampleHeading = headings.find((h) => h.title === 'Минимальный пример');
  if (exampleHeading) {
    const after = headings[headings.indexOf(exampleHeading) + 1]?.line ?? lines.length + 1;
    const fences = lines
      .slice(exampleHeading.line, after - 1)
      .filter((l) => /^\s*(```|~~~)/.test(l)).length;
    if (fences !== 2) {
      add('ERROR', 'pkg-readme-sections', file,
        `в «Минимальном примере» ${fences / 2} блоков кода вместо одного`);
    }
  }

  // 9.5 Раздел «Экспорты»: бюджет строк и полнота перечня
  const exportsHeading = headings.find((h) => h.title === 'Экспорты');
  if (!exportsHeading) continue;
  const next = headings[headings.indexOf(exportsHeading) + 1]?.line ?? lines.length + 1;
  const section = lines.slice(exportsHeading.line - 1, next - 1);
  while (section.length && !section.at(-1).trim()) section.pop();
  if (section.length > EXPORTS_MAX_LINES) {
    add('ERROR', 'pkg-exports-budget', file,
      `раздел «Экспорты» занимает ${section.length} строк при потолке ${EXPORTS_MAX_LINES}`);
  }

  const pkg = collectPackageExports(dir);
  const sectionText = section.join('\n');

  for (const s of pkg.subpaths) {
    if (!s.barrel) {
      add('ERROR', 'pkg-exports', join(dir, 'package.json'),
        `подпуть «${s.key}» из exports не ведёт ни в один файл src`);
      continue;
    }
    if (s.key !== '.' && !sectionText.includes(s.key)) {
      add('ERROR', 'pkg-exports', file, `в разделе «Экспорты» нет группы подпути «${s.key}»`);
    }
    for (const m of s.missing) {
      add('ERROR', 'pkg-exports', file, `не разрешён реэкспорт ${m}`);
    }
  }

  if (!pkg.subpaths.some((s) => s.barrel)) {
    // Пакет-инструмент: вместо перечня имён README называет команду.
    for (const command of pkg.bin) {
      if (!sectionText.includes(command)) {
        add('ERROR', 'pkg-exports', file, `в разделе «Экспорты» не названа команда ${command}`);
      }
    }
    continue;
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
        `имена реэкспортированы из ${source}, а ссылки на этот пакет в разделе «Экспорты» нет`);
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
