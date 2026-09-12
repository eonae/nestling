#!/usr/bin/env node
/**
 * Сборка документации: источники из `sections.mjs` → две формы вывода в
 * `docs/.site/`.
 *
 * Первый шаг читает источники и строит модель разделов: заголовок, секция,
 * слаг, группа, размеченный HTML, заголовки второго уровня. Второй печатает
 * модель дважды: деревом страниц `<секция>/<слаг>/index.html` и файлом
 * `nestling-docs.html`, где все разделы лежат сразу. Формы отличаются одним
 * — как раздел и якорь превращаются в `href`.
 *
 * Источников три вида: папка с оглавлением `README.md`, отдельная страница и
 * пакеты. У папки состав и порядок разделов берутся из её README: заголовки
 * `## Часть N. …` дают группы сайдбара, строки таблиц под ними — файлы папки.
 * У пакетов оглавление лежит в разделе «Пакеты» файла `docs/README.md`, и
 * группы дают его заголовки `###`.
 *
 * Каркас документа и тема лежат рядом со скриптом, в `scripts/site/`;
 * оформление, поведение и подсветка кода попадают внутрь каждой страницы.
 * Каталог `docs/.site/` — результат сборки, git его не отслеживает.
 *
 *   yarn docs:build   — собрать один раз
 *   yarn docs:build --base https://example.org — с базовым адресом
 *   yarn docs:dev     — поднять локальный сервер и пересобирать при правке
 */

import {
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import MarkdownIt from 'markdown-it';
import attrs from 'markdown-it-attrs';
import container from 'markdown-it-container';

import { PACKAGES_OUTLINE, SECTIONS, TOP_LINKS } from './sections.mjs';

/** Каталог скрипта: рядом лежат каркас документа и тема */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'docs', '.site');

/** Вся документация одним файлом: его пересылают и открывают двойным кликом */
const SINGLE_FILE = 'nestling-docs.html';

/** Имя проекта в заголовке страницы и в Open Graph */
const SITE_NAME = 'Nestling';

/**
 * Разделитель приставки раздела в идентификаторе заголовка.
 *
 * Дефисов два, потому что имена разделов и якоря содержат по одному:
 * одиночный не отличил бы приставку от продолжения имени.
 */
const ANCHOR_SEP = '--';

/** Алиасы языков: то, что пишем в ```-заборе → значение data-lang. */
const LANG_ALIAS = { ts: 'typescript', js: 'javascript', sh: 'bash', shell: 'bash' };

/* ------------------------------------------------------------------ утилиты */

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

/** Подстановка в каркас: значение попадает дословно, `$` в нём не спецсимвол */
const fill = (template, slot, value) => template.replace(slot, () => value);

/** Ошибка сборки: текст уже объясняет, что править в документации */
class BuildError extends Error {}

/** Путь файла от корня репозитория: он попадает в сообщения об ошибках */
const rel = (path) => relative(ROOT, path);

/* --------------------------------------------------------------- подсветка */

/**
 * Подсветка выполняется здесь, а не в браузере.
 *
 * Файл пересылают, печатают и открывают в режиме чтения — везде, где
 * JavaScript выключен, разметка подсветки должна уже лежать в HTML.
 * Правила языка — набор групп одного регулярного выражения: группа с
 * номером N красится классом с номером N.
 */
const TS_KEYWORDS =
  'const|let|var|function|return|await|async|new|class|interface|type|import|export|' +
  'from|extends|implements|if|else|for|of|in|while|switch|case|default|break|continue|throw|' +
  'try|catch|finally|typeof|instanceof|as|void|this|super|yield|enum|public|private|protected|' +
  'readonly|static|declare|namespace|true|false|null|undefined|infer|keyof|satisfies';

const SHELL_KEYWORDS =
  'if|then|elif|else|fi|for|while|until|do|done|case|esac|function|in|return|' +
  'export|local|source|set|unset|cd|echo|exit';

/**
 * Правила языков: регулярное выражение с группами и классы этих групп.
 *
 * Языков четыре, потому что столько встречается в документации: примеры на
 * TypeScript, команды на bash, ответы и конфиги на json.
 */
const LANGUAGES = {
  typescript: {
    re: new RegExp(
      '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)' + // 1 комментарий
        '|(`(?:\\\\.|[^`\\\\])*`|\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*")' + // 2 строка
        '|(@[A-Za-z_]\\w*)' + // 3 декоратор
        '|\\b(\\d[\\d_]*\\.?\\d*)\\b' + // 4 число
        '|\\b(' + TS_KEYWORDS + ')\\b' + // 5 ключевое слово
        '|\\b([A-Z][A-Za-z0-9_]*)\\b' + // 6 тип
        '|\\b([a-z_$][\\w$]*)(?=\\s*\\()', // 7 вызов
      'g',
    ),
    classes: [
      'tok-com',
      'tok-str',
      'tok-deco',
      'tok-num',
      'tok-key',
      'tok-type',
      'tok-fn',
    ],
  },
  bash: {
    re: new RegExp(
      '(#[^\\n]*)' + // 1 комментарий
        '|(\'[^\']*\'|"(?:\\\\.|[^"\\\\])*")' + // 2 строка
        '|(\\$\\{[^}]*\\}|\\$[A-Za-z_]\\w*)' + // 3 переменная
        '|(\\s--?[A-Za-z][\\w-]*)' + // 4 ключ команды
        '|\\b(' + SHELL_KEYWORDS + ')\\b' + // 5 ключевое слово
        '|(^|[|&;]\\s*)([\\w.:@/-]+)', // 6+7 команда в начале строки или конвейера
      'gm',
    ),
    classes: ['tok-com', 'tok-str', 'tok-deco', 'tok-type', 'tok-key', null, 'tok-fn'],
  },
  json: {
    re: new RegExp(
      '("(?:\\\\.|[^"\\\\])*")(\\s*:)' + // 1 ключ, 2 двоеточие после него
        '|("(?:\\\\.|[^"\\\\])*")' + // 3 строка-значение
        '|\\b(-?\\d[\\d.eE+-]*)\\b' + // 4 число
        '|\\b(true|false|null)\\b', // 5 литерал
      'g',
    ),
    classes: ['tok-fn', null, 'tok-str', 'tok-num', 'tok-key'],
  },
};

LANGUAGES.javascript = LANGUAGES.typescript;

/**
 * Размечает код языка классами токенов.
 *
 * Группа правила красится классом с тем же номером. Класс `null` означает
 * «часть совпадения, которая цветом не выделяется»: так `bash` отличает
 * команду от предшествующего ей разделителя конвейера.
 *
 * Язык без правил остаётся текстом: блок без забора-языка — это вывод
 * команды или схема, и раскраска по правилам TypeScript в них врёт.
 */
function highlight(code, lang) {
  const rules = LANGUAGES[lang];

  if (!rules) {
    return escapeHtml(code);
  }

  let out = '';
  let last = 0;
  let m;

  rules.re.lastIndex = 0;
  while ((m = rules.re.exec(code)) !== null) {
    if (m.index > last) {
      out += escapeHtml(code.slice(last, m.index));
    }

    let at = m.index;
    for (const [index, className] of rules.classes.entries()) {
      const part = m[index + 1];
      if (part === undefined) continue;

      out += className
        ? `<span class="${className}">${escapeHtml(part)}</span>`
        : escapeHtml(part);
      at += part.length;
    }

    // Совпадение без единой заполненной группы съело бы символ молча
    if (at === m.index) {
      out += escapeHtml(m[0]);
      at += m[0].length || 1;
    }

    last = at;
    rules.re.lastIndex = last;
  }

  return out + escapeHtml(code.slice(last));
}

/* ---------------------------------------------------------------- markdown */

const md = new MarkdownIt({ html: true, linkify: false, typographer: false });

// `{#id}` на заголовках, `{.class}` на абзацах, ссылках и ячейках таблиц.
md.use(attrs, { allowedAttributes: ['id', 'class'] });

/**
 * :::note Заголовок          → <div class="note">
 * :::note good Заголовок     → <div class="note good">
 * :::note warn Заголовок     → <div class="note warn">
 */
md.use(container, 'note', {
  validate: (params) => /^note(\s|$)/.test(params.trim()),
  render(tokens, idx) {
    if (tokens[idx].nesting !== 1) return '</div>\n';
    const m = /^note\s*(good|warn)?\s*([\s\S]*)$/.exec(tokens[idx].info.trim());
    const variant = m[1] ? ` ${m[1]}` : '';
    const title = (m[2] || '').trim();
    if (!title)
      throw new BuildError('У :::note обязателен заголовок: `:::note Заголовок`');
    return `<div class="note${variant}">\n<span class="note-t">${md.renderInline(title)}</span>\n`;
  },
});

/** ::::cards … :::: — сетка карточек. */
md.use(container, 'cards', {
  validate: (params) => params.trim() === 'cards',
  render: (tokens, idx) =>
    tokens[idx].nesting === 1 ? '<div class="grid">\n' : '</div>\n',
});

/** :::card 🧩 Заголовок — одна карточка внутри ::::cards. */
md.use(container, 'card', {
  validate: (params) => /^card(\s|$)/.test(params.trim()),
  render(tokens, idx) {
    if (tokens[idx].nesting !== 1) return '</div>\n';
    const rest = tokens[idx].info.trim().slice('card'.length).trim();
    const m = /^(\S+)\s+([\s\S]+)$/.exec(rest);
    if (!m)
      throw new BuildError(
        `:::card ждёт «иконку и заголовок», получено: ${rest || '(пусто)'}`,
      );
    return (
      `<div class="card"><span class="ic">${m[1]}</span>` +
      `<h3 class="card-t">${md.renderInline(m[2])}</h3>`
    );
  },
});

/**
 * Первая строка-комментарий с путём становится подписью блока.
 *
 * Главы гайда начинают сниппет строкой `// examples/…/file.ts`; она же
 * говорит читателю, какой файл примера открыть. Строка остаётся в коде:
 * скопированный сниппет не теряет адрес.
 */
function fileOf(code) {
  const [first] = code.split('\n');
  const m = /^\s*\/\/\s*([\w./@-]+\.[a-z]+)\s*$/.exec(first ?? '');

  return m ? m[1] : '';
}

/** Шапка блока кода: три точки, имя файла и язык */
function renderCodeHead(file, lang) {
  const dots = '<span class="dot"></span>'.repeat(3);
  const name = file ? `<span class="fname">${escapeHtml(file)}</span>` : '';
  const label = lang ? `<span class="lang">${escapeHtml(lang)}</span>` : '';

  return `<div class="code-head">${dots}${name}${label}</div>`;
}

/**
 * ```ts            → <div class="code" data-lang="typescript">
 * Подпись `data-file` берётся из первой строки-комментария сниппета.
 * Шапка блока и разметка подсветки пишутся сразу: браузеру доделывать
 * нечего.
 */
md.renderer.rules.fence = (tokens, idx) => {
  const info = tokens[idx].info.trim();
  const alias = info.split(/\s/)[0];
  const lang = LANG_ALIAS[alias] ?? alias;
  const code = tokens[idx].content.replace(/\n$/, '');
  const file = fileOf(code);
  const fileAttr = file ? ` data-file="${escapeAttr(file)}"` : '';
  const langAttr = lang ? ` data-lang="${escapeAttr(lang)}"` : '';

  return (
    `<div class="code"${fileAttr}${langAttr}>` +
    renderCodeHead(file, lang) +
    `<pre><code>${highlight(code, lang)}</code></pre></div>\n`
  );
};

// Списки в статье оформляются как ul.body / ol.body — если класс не задан явно.
for (const rule of ['bullet_list_open', 'ordered_list_open']) {
  md.renderer.rules[rule] = (tokens, idx, options, env, self) => {
    if (!tokens[idx].attrGet('class')) tokens[idx].attrSet('class', 'body');
    return self.renderToken(tokens, idx, options, env);
  };
}

// Таблицы всегда в горизонтальном скроллере.
md.renderer.rules.table_open = () => '<div class="tbl-wrap">\n<table>\n';
md.renderer.rules.table_close = () => '</table>\n</div>\n';

/* ------------------------------------------------------- состав источников */

/** Заголовок первого уровня файла: он же заголовок его раздела */
function titleOf(text, path) {
  const m = /^#\s+(.+?)\s*$/m.exec(text);

  if (!m) {
    throw new BuildError(`${rel(path)}: нет заголовка первого уровня`);
  }

  return m[1].replace(/`/g, '');
}

/**
 * Читает состав папки-источника из её README.
 *
 * Группа — заголовок `## Часть N. …`; файлы группы — строки таблицы под
 * ним: первая ячейка несёт ссылку на файл. У папки без таких заголовков
 * группа одна и названа в `sections.mjs`.
 *
 * @returns Файлы в порядке README: `{ slug, group }`
 */
function readOutline(readme, readmePath, fallbackGroup) {
  const parted = /^##\s+Часть\s+\d+\./m.test(readme);
  const files = [];
  let group;

  for (const line of readme.split('\n')) {
    const heading = /^##\s+(Часть\s+\d+\.[^\n]*)\s*$/.exec(line);
    if (heading) {
      group = heading[1].replace(/\.$/, '');
      continue;
    }

    const cell = /^\|\s*\[[^\]]+\]\(\.\/([\w-]+)\.md\)/.exec(line);
    if (!cell) {
      continue;
    }

    if (parted && !group) {
      throw new BuildError(
        `${rel(readmePath)}: файл '${cell[1]}' стоит вне раздела «Часть N»`,
      );
    }

    files.push({ slug: cell[1], group: group ?? fallbackGroup });
  }

  if (files.length === 0) {
    throw new BuildError(
      `${rel(readmePath)}: в таблицах нет ни одной ссылки на файл папки`,
    );
  }

  return files;
}

/**
 * Читает состав источника-пакетов из раздела «Пакеты» файла `docs/README.md`.
 *
 * Группа — заголовок `###` этого раздела; пакеты группы — строки таблиц под
 * ним со ссылкой на каталог пакета. Второго списка пакетов не существует:
 * карта репозитория и есть оглавление справочника.
 *
 * @returns Каталоги в порядке карты: `{ slug, group }`
 */
function readPackagesOutline(outlinePath) {
  const lines = readFileSync(outlinePath, 'utf8').split('\n');
  const from = lines.findIndex((line) => /^##\s+Пакеты\s*$/.test(line));

  if (from === -1) {
    throw new BuildError(`${rel(outlinePath)}: нет раздела «## Пакеты»`);
  }

  const rest = lines.slice(from + 1);
  const to = rest.findIndex((line) => /^##\s/.test(line));

  const entries = [];
  let group;

  for (const line of to === -1 ? rest : rest.slice(0, to)) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      group = heading[1];
      continue;
    }

    const cell = /^\|\s*\[[^\]]+\]\(\.\.\/packages\/([\w.-]+)\/?\)/.exec(line);
    if (!cell) {
      continue;
    }

    if (!group) {
      throw new BuildError(
        `${rel(outlinePath)}: пакет '${cell[1]}' стоит вне заголовка «###»`,
      );
    }

    entries.push({ slug: cell[1], group });
  }

  if (entries.length === 0) {
    throw new BuildError(
      `${rel(outlinePath)}: в разделе «Пакеты» нет ни одной ссылки на каталог`,
    );
  }

  return entries;
}

/**
 * Сверяет состав оглавления с каталогами на диске.
 *
 * Расхождение в любую сторону — ошибка сборки: раздел без файла собрался
 * бы пустым, а файл без строки оглавления не попал бы в навигацию и остался
 * бы недоступным. Проверка идёт по каждому источнику отдельно.
 */
function assertComplete(entries, found, outlinePath, missing, extra) {
  const listed = new Set(entries.map((entry) => entry.slug));

  for (const { slug } of entries) {
    if (!found.includes(slug)) {
      throw new BuildError(`${rel(outlinePath)} ${missing(slug)}`);
    }
  }

  for (const slug of found) {
    if (!listed.has(slug)) {
      throw new BuildError(`${extra(slug)} не упомянут в ${rel(outlinePath)}`);
    }
  }
}

/** Файлы папки-источника: всё, кроме её оглавления */
const filesIn = (dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => name.replace(/\.md$/, ''));

/** Каталоги `packages/`: пакетом считается каталог с манифестом */
const packageDirs = (dir) =>
  readdirSync(dir).filter(
    (name) =>
      statSync(join(dir, name)).isDirectory() &&
      existsSync(join(dir, name, 'package.json')),
  );

/**
 * Первый абзац раздела: он идёт в `description` страницы.
 *
 * Заголовок, плашки-цитаты, таблицы, блоки кода и врезки пропускаются:
 * описанием служит первая связная фраза о предмете раздела.
 */
function summaryOf(text) {
  const lines = text.split('\n');
  const paragraph = [];
  let fence = false;

  for (const line of lines) {
    if (/^```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;

    const trimmed = line.trim();

    if (paragraph.length > 0) {
      if (!trimmed) break;
      paragraph.push(trimmed);
      continue;
    }

    if (!trimmed || /^(#|>|\||:{3,}|[-*] |\d+\. |<)/.test(trimmed)) continue;
    paragraph.push(trimmed);
  }

  const plain = paragraph
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return plain.length > 200 ? `${plain.slice(0, 197).trimEnd()}…` : plain;
}

/**
 * Якорь заголовка по правилам GitHub: нижний регистр, знаки препинания
 * выброшены, пробел заменён дефисом и подряд идущие пробелы не схлопнуты.
 *
 * Правило чужое, потому что ссылки на заголовки пишутся один раз и
 * читаются в двух местах: на сайте и в репозитории.
 */
function slugifyAnchor(label) {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/**
 * Заголовки второго и третьего уровня в порядке текста.
 *
 * Второй уровень раскрывается подпунктами сайдбара и попадает в индекс
 * поиска. Третий получает `id`, потому что на него ссылаются: `§4.1` в
 * тексте — это ссылка на заголовок `### 4.1 …`.
 */
function headingsOf(text) {
  const headings = [];
  let fence = false;

  for (const line of text.split('\n')) {
    if (/^```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;

    const m = /^(#{2,3})\s+(.+?)\s*(\{#([\w-]+)\})?\s*$/.exec(line);
    if (!m) {
      continue;
    }

    const label = m[2].replace(/`/g, '');
    headings.push({
      level: m[1].length,
      label,
      anchor: m[4] ?? slugifyAnchor(label),
    });
  }

  return headings;
}

/** Текст раздела без разметки: он идёт в индекс поиска */
function plainTextOf(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[>|]\s?/gm, ' ')
    .replace(/^:{3,}.*$/gm, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Адрес раздела: сегменты пути от корня вывода.
 *
 * У оглавления источника адрес совпадает с секцией — `/guide/` открывает
 * `docs/guide/README.md`. У стартовой страницы сегментов нет вовсе.
 */
function routeOf(kind, section, slug) {
  if (kind === 'home') return [];
  if (kind === 'index') return [section];

  return section ? [section, slug] : [slug];
}

/** Идентификатор раздела в форме одного файла */
function idOf(kind, section, slug) {
  if (kind === 'home') return 'home';
  if (kind === 'index') return section;

  return section ? `${section}${ANCHOR_SEP}${slug}` : slug;
}

/** Один раздел модели: всё, что печать берёт из исходного файла */
function makePage({ kind, section, slug, path, source, group, badge }) {
  const headings = headingsOf(source);

  return {
    kind,
    section,
    slug,
    group,
    badge,
    path,
    dir: dirname(path),
    source,
    title: titleOf(source, path),
    summary: summaryOf(source),
    headings,
    heads: headings.filter((heading) => heading.level === 2),
    route: routeOf(kind, section, slug),
    id: idOf(kind, section, slug),
  };
}

/**
 * Разворачивает `sections.mjs` в плоский список разделов документации.
 *
 * Слаг уникален внутри своего источника: `/design/container/` и
 * `/reference/nestling.container/` не спорят, потому что секции у них
 * разные. Совпадение внутри источника останавливает сборку.
 *
 * @returns Разделы в порядке `sections.mjs`
 */
function readModel() {
  const pages = [];

  for (const source of SECTIONS) {
    const path = join(ROOT, source.path);
    const before = pages.length;

    if (source.kind === 'home' || source.kind === 'page') {
      pages.push(
        makePage({
          kind: source.kind,
          section: '',
          slug: basename(source.path, '.md'),
          path,
          source: readFileSync(path, 'utf8'),
          group: source.group,
          badge: source.badge,
        }),
      );
    } else if (source.kind === 'folder') {
      const readmePath = join(path, 'README.md');
      const readme = readFileSync(readmePath, 'utf8');
      const entries = readOutline(readme, readmePath, source.group);

      assertComplete(
        entries,
        filesIn(path),
        readmePath,
        (slug) => `называет файл '${slug}.md', которого нет в ${rel(path)}`,
        (slug) => `${rel(join(path, slug))}.md`,
      );

      pages.push(
        makePage({
          kind: 'index',
          section: source.section,
          slug: source.section,
          path: readmePath,
          source: readme,
          group: source.group,
          badge: source.badge,
        }),
      );

      for (const entry of entries) {
        const filePath = join(path, `${entry.slug}.md`);
        pages.push(
          makePage({
            kind: 'doc',
            section: source.section,
            slug: entry.slug,
            path: filePath,
            source: readFileSync(filePath, 'utf8'),
            group: entry.group,
            badge: source.badge,
          }),
        );
      }
    } else if (source.kind === 'packages') {
      const outlinePath = join(ROOT, PACKAGES_OUTLINE);
      const entries = readPackagesOutline(outlinePath);

      assertComplete(
        entries,
        packageDirs(path),
        outlinePath,
        (slug) => `называет каталог '${slug}', которого нет в ${rel(path)}`,
        (slug) => `${rel(join(path, slug))}`,
      );

      for (const entry of entries) {
        const readmePath = join(path, entry.slug, 'README.md');
        if (!existsSync(readmePath)) {
          throw new BuildError(`${rel(readmePath)} не найден: у пакета нет README`);
        }

        pages.push(
          makePage({
            kind: 'doc',
            section: source.section,
            slug: entry.slug,
            path: readmePath,
            source: readFileSync(readmePath, 'utf8'),
            group: entry.group,
            badge: source.badge,
          }),
        );
      }
    } else {
      throw new BuildError(`неизвестный вид источника: '${source.kind}'`);
    }

    const seen = new Map();
    for (const page of pages.slice(before)) {
      if (seen.has(page.slug)) {
        throw new BuildError(
          `в источнике ${source.path} слаг '${page.slug}' занят дважды: ` +
            `${rel(seen.get(page.slug))} и ${rel(page.path)}`,
        );
      }
      seen.set(page.slug, page.path);
    }
  }

  const ids = new Map();
  for (const page of pages) {
    if (ids.has(page.id)) {
      throw new BuildError(
        `идентификатор раздела '${page.id}' занят дважды: ` +
          `${rel(ids.get(page.id))} и ${rel(page.path)}`,
      );
    }
    ids.set(page.id, page.path);
  }

  return pages;
}

/* ------------------------------------------------------------------ адреса */

/** Путь от адреса одного раздела к адресу другого: оба кончаются каталогом */
function routeHref(from, to) {
  const path = posix.relative(from.join('/'), to.join('/'));

  return path ? `${path}/` : './';
}

/** Путь от адреса раздела к корню вывода: им собираются адреса файлов сайта */
function routeRoot(from) {
  const path = posix.relative(from.join('/'), '');

  return path ? `${path}/` : '';
}

/**
 * Форма вывода: всё, чем дерево страниц отличается от одного файла.
 *
 * Различие сводится к адресам. В дереве раздел адресуется путём, а якорь
 * заголовка совпадает с его текстом. В одном файле раздел адресуется
 * якорем, а идентификатор заголовка получает приставку раздела: иначе
 * одинаковые заголовки разных разделов столкнулись бы в одном документе.
 */
const TREE = {
  name: 'tree',
  headingId: (page, anchor) => anchor,
  href: (from, to, anchor) => {
    const path = routeHref(from.route, to.route);
    const base = path === './' ? '' : path;

    return anchor ? `${base}#${anchor}` : base || './';
  },
  root: (from) => routeRoot(from.route),
};

const SINGLE = {
  name: 'single',
  headingId: (page, anchor) => `${page.id}${ANCHOR_SEP}${anchor}`,
  href: (from, to, anchor) =>
    anchor ? `#${to.id}${ANCHOR_SEP}${anchor}` : `#${to.id}`,
  root: () => '',
};

/* ------------------------------------------------------------------ ссылки */

/** Адрес репозитория: из него собираются ссылки на неопубликованные файлы */
function repositoryUrl() {
  const { repository } = JSON.parse(
    readFileSync(join(ROOT, 'package.json'), 'utf8'),
  );
  const url = typeof repository === 'string' ? repository : repository?.url;

  if (!url) {
    throw new BuildError(
      'package.json не называет поле `repository`: ссылку на файл вне ' +
        'разделов сайта собрать не из чего',
    );
  }

  return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/$/, '');
}

const REPOSITORY = repositoryUrl();

/** Ссылка в файл репозитория: он не стал разделом, значит читается на GitHub */
function githubHref(abs, anchor) {
  const kind = statSync(abs).isDirectory() ? 'tree' : 'blob';
  const path = relative(ROOT, abs).split('\\').join('/');

  return `${REPOSITORY}/${kind}/main/${path}${anchor ? `#${anchor}` : ''}`;
}

/**
 * Переписывает ссылки раздела по правилам формы.
 *
 * Ссылка в файл, который стал разделом сайта, ведёт на его адрес. Любая
 * другая ссылка в репозиторий ведёт на GitHub: `decisions/ideas.md`,
 * `history/` и `openspec/` на сайте не публикуются, и без этого правила
 * плашки design-доков вели бы в 404.
 *
 * @throws {BuildError} Ссылка на файл, которого нет
 */
function rewriteLinks(text, page, byPath, form) {
  // Сначала ссылки внутрь своего файла: иначе приставку получил бы и
  // результат переписывания ссылок на соседние разделы
  const local = text.replace(
    /\]\(#([^)\s]+)\)/g,
    (all, anchor) => `](${form.href(page, page, anchor)})`,
  );

  return local.replace(/\]\((\.{1,2}\/[^)\s]+?)\)/g, (all, target) => {
    const [raw, anchor] = target.split('#');
    if (!raw) {
      return all;
    }

    const abs = resolve(page.dir, decodeURI(raw)).replace(/\/$/, '');
    const to = byPath.get(abs);

    if (to) {
      return `](${form.href(page, to, anchor)})`;
    }

    if (!existsSync(abs)) {
      throw new BuildError(
        `${rel(page.path)} ссылается на '${raw}', которого нет в репозитории`,
      );
    }

    return `](${githubHref(abs, anchor)})`;
  });
}

/** Ставит `id` заголовкам `##` и `###`, а явным `{#id}` — приставку раздела */
function anchorHeadings(html, page, form) {
  let index = 0;

  const explicit = html.replace(
    /(<h[1-6][^>]*\sid=")([^"]*)(")/g,
    (all, head, id, tail) =>
      `${head}${escapeAttr(form.headingId(page, id))}${tail}`,
  );

  // Заголовок карточки помечен классом: он оформление, а не раздел текста
  return explicit.replace(/<(h[23])(\s[^>]*)?>/g, (all, tag, attributes = '') => {
    if (/\bclass="card-t"/.test(attributes)) {
      return all;
    }

    const heading = page.headings[index++];

    if (!heading || /\bid=/.test(attributes)) {
      return all;
    }

    return `<${tag}${attributes} id="${escapeAttr(form.headingId(page, heading.anchor))}">`;
  });
}

/* ------------------------------------------------------------------ каркас */

/**
 * Пункт раздела в сайдбаре и список его заголовков.
 *
 * Заголовки показываются у читаемого раздела: семьдесят разделов сразу
 * дали бы больше трёхсот подпунктов. В дереве читаемый раздел известен на
 * сборке, в одном файле его находит встроенный скрипт.
 */
function renderNavItem(page, from, form, active) {
  const id = escapeAttr(page.id);
  const href = escapeAttr(form.href(from, page));
  const cls = active ? ' class="active"' : '';
  const link =
    `      <li><a${cls} href="${href}" data-chapter="${id}">` +
    `${escapeHtml(page.title)}</a>`;

  // В дереве подпункты печатаются только у открытой страницы: у остальных
  // они вели бы на чужой документ и в списке были бы шумом
  const withSub = form.name === 'single' || active;
  if (page.heads.length === 0 || !withSub) {
    return `${link}</li>`;
  }

  const sub = page.heads
    .map(
      (head) =>
        `          <li><a href="${escapeAttr(form.href(from, page, head.anchor))}">` +
        `${escapeHtml(head.label)}</a></li>`,
    )
    .join('\n');

  const open = active && form.name === 'tree' ? ' open' : '';

  return (
    `${link}\n        <ul class="nav-sub${open}" data-for="${id}">\n` +
    `${sub}\n        </ul></li>`
  );
}

/**
 * Сайдбар страницы: все группы и разделы, адреса — по правилам формы.
 *
 * В дереве `from` — открытая страница: от неё считаются относительные
 * адреса, и её пункт печатается активным. В одном файле открытой страницы
 * нет, `from` пуст, а активный пункт находит встроенный скрипт.
 */
function renderSidebar(pages, from, form) {
  const groups = [];

  for (const page of pages) {
    if (page.kind === 'home') {
      continue;
    }

    const last = groups.at(-1);

    if (last && last.name === page.group) {
      last.pages.push(page);
    } else {
      groups.push({ name: page.group, pages: [page] });
    }
  }

  const rendered = groups.map(({ name, pages: items }) => {
    const title = `  <p class="nav-title">${escapeHtml(name)}</p>`;
    const links = items
      .map((page) => renderNavItem(page, from, form, page === from))
      .join('\n');

    return `  <div class="nav-group">\n${title}\n    <ul>\n${links}\n    </ul>\n  </div>`;
  });

  return `<aside class="sidebar">\n${rendered.join('\n')}\n</aside>`;
}

/** Ссылки на соседние разделы в порядке `sections.mjs` */
function renderPager({ prev, next }, from, form) {
  const link = (page, dir, cls) =>
    `    <a${cls ? ` class="${cls}"` : ''} href="${escapeAttr(form.href(from, page))}">\n` +
    `      <div class="dir">${escapeHtml(dir)}</div>\n` +
    `      <div class="ttl">${escapeHtml(page.title)}</div>\n` +
    `    </a>`;

  const parts = [prev ? link(prev, '← Назад', '') : '    <span></span>'];
  if (next) {
    parts.push(link(next, 'Далее →', 'next'));
  }

  return `  <nav class="pager">\n${parts.join('\n')}\n  </nav>\n`;
}

/** Бейдж источника в шапке раздела */
const renderBadge = (page) =>
  page.badge ? `<p class="badge">${escapeHtml(page.badge)}</p>\n` : '';

/** Быстрые ссылки шапки: разделы, которые читатель ищет чаще прочих */
function renderTopLinks(byId, from, form) {
  return TOP_LINKS.map(({ id, label }) => {
    const page = byId.get(id);

    return page
      ? `  <a class="tlink hide-sm" href="${escapeAttr(form.href(from, page))}">` +
          `${escapeHtml(label)}</a>`
      : '';
  })
    .filter(Boolean)
    .join('\n');
}

/** Поле поиска: индекс подгружается по первому обращению, сервер не нужен */
const SEARCH_BOX =
  '  <div class="search">\n' +
  '    <input id="q" type="search" placeholder="Поиск по документации" ' +
  'autocomplete="off" aria-label="Поиск по документации">\n' +
  '    <div class="results" id="results" hidden></div>\n' +
  '  </div>';

/** Птенец из шапки, отрисованный в иконку вкладки */
const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n' +
  '  <rect width="64" height="64" rx="14" fill="#e07a3e"/>\n' +
  '  <text x="32" y="45" font-size="38" text-anchor="middle">🐣</text>\n' +
  '</svg>\n';

/* ------------------------------------------------------------- метаданные */

/** `title`, `description`, Open Graph и favicon одной страницы */
function renderHead(page, { root, base, canonical }) {
  const title =
    page.kind === 'home'
      ? `${SITE_NAME} — документация`
      : `${page.title} — ${SITE_NAME}`;
  const description = page.summary;

  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeAttr(description)}">`,
    `<link rel="icon" href="${escapeAttr(`${root}favicon.svg`)}" type="image/svg+xml">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(description)}">`,
    `<meta name="twitter:card" content="summary">`,
  ];

  if (base) {
    tags.push(`<link rel="canonical" href="${escapeAttr(canonical)}">`);
    tags.push(`<meta property="og:url" content="${escapeAttr(canonical)}">`);
  }

  return tags.join('\n');
}

/** Адрес страницы от базового адреса сайта */
const absoluteUrl = (base, route) =>
  route.length === 0 ? `${base}/` : `${base}/${route.join('/')}/`;

/* ------------------------------------------------------------------ печать */

/** Разметка одного раздела: бейдж, статья и пейджер */
function renderArticle(page, neighbours, byPath, form) {
  const text = rewriteLinks(page.source, page, byPath, form);
  const article = anchorHeadings(md.render(text), page, form);
  const pager = page.kind === 'home' ? '' : renderPager(neighbours, page, form);

  return renderBadge(page) + article + pager;
}

function renderTreePage(page, parts, options) {
  const { layout, homeLayout, styles, script, byId, byPath, base } = options;
  const template = page.kind === 'home' ? homeLayout : layout;
  const root = TREE.root(page);
  const canonical = base ? absoluteUrl(base, page.route) : '';

  let html = fill(template, '{{head}}', renderHead(page, { root, base, canonical }));
  html = fill(html, '{{styles}}', styles);
  html = fill(html, '{{root}}', escapeAttr(root));
  html = fill(html, '{{mode}}', 'tree');
  html = fill(
    html,
    '{{home}}',
    escapeAttr(TREE.href(page, byId.get('home'))),
  );
  html = fill(html, '{{toplinks}}', renderTopLinks(byId, page, TREE));
  html = fill(html, '{{search}}', SEARCH_BOX);

  if (page.kind !== 'home') {
    html = fill(html, '{{sidebar}}', renderSidebar(options.pages, page, TREE));
  }

  html = fill(html, '{{article}}', renderArticle(page, parts, byPath, TREE));
  html = fill(html, '{{script}}', script);

  return html;
}

function renderSingleFile(pages, options) {
  const { layout, styles, script, byId, byPath } = options;
  const start = byId.get('home');

  const body = pages
    .map((page, index) => {
      const article = renderArticle(
        page,
        { prev: pages[index - 1], next: pages[index + 1] },
        byPath,
        SINGLE,
      );

      return (
        `<section class="chapter" id="${escapeAttr(page.id)}">\n` +
        `${article}</section>`
      );
    })
    .join('\n');

  // Иконка идёт строкой данных: соседних файлов у этой формы нет
  const icon = `data:image/svg+xml;base64,${Buffer.from(FAVICON).toString('base64')}`;

  let html = fill(
    layout,
    '{{head}}',
    `<title>${escapeHtml(`${SITE_NAME} — документация`)}</title>\n` +
      `<meta name="description" content="${escapeAttr(start.summary)}">\n` +
      `<link rel="icon" href="${escapeAttr(icon)}" type="image/svg+xml">`,
  );
  html = fill(html, '{{styles}}', styles);
  html = fill(html, '{{root}}', '');
  html = fill(html, '{{mode}}', 'single');
  html = fill(html, '{{home}}', `#${escapeAttr(start.id)}`);
  html = fill(html, '{{toplinks}}', renderTopLinks(byId, start, SINGLE));
  html = fill(html, '{{search}}', '');
  html = fill(html, '{{sidebar}}', renderSidebar(pages, null, SINGLE));
  html = fill(html, '{{article}}', body);
  html = fill(html, '{{script}}', script);

  return html;
}

/* ------------------------------------------------------- файлы публикации */

const robotsTxt = (base) =>
  ['User-agent: *', 'Allow: /', base ? `Sitemap: ${base}/sitemap.xml` : '']
    .filter(Boolean)
    .join('\n') + '\n';

const sitemapXml = (pages, base) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  pages
    .map((page) => `  <url><loc>${escapeHtml(absoluteUrl(base, page.route))}</loc></url>`)
    .join('\n') +
  '\n</urlset>\n';

/** Индекс поиска: заголовок, адрес, заголовки второго уровня и текст */
const searchIndex = (pages) =>
  JSON.stringify(
    pages.map((page) => ({
      title: page.title,
      group: page.group ?? '',
      path: page.route.length === 0 ? '' : `${page.route.join('/')}/`,
      heads: page.heads.map((head) => ({ label: head.label, anchor: head.anchor })),
      text: plainTextOf(page.source).slice(0, 4000),
    })),
  );

/** Страница «не найдено»: её отдаёт хостинг по любому неизвестному адресу */
const notFoundHtml = (styles, base) =>
  '<!DOCTYPE html>\n<html lang="ru" data-theme="">\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  `<title>Страница не найдена — ${SITE_NAME}</title>\n` +
  '<meta name="robots" content="noindex">\n' +
  `<style>\n${styles}\n</style>\n</head>\n<body class="home">\n` +
  '<header class="topbar">\n' +
  `  <a class="brand" href="${escapeAttr(base ? `${base}/` : '/')}">` +
  '<span class="logo">🐣</span> Nestling ' +
  '<span class="tag hide-sm">документация</span></a>\n' +
  '</header>\n' +
  '<main class="content"><article class="article">\n' +
  '<h1>Такой страницы нет</h1>\n' +
  '<p>Адрес раздела мог измениться: документация собирается заново на ' +
  'каждое изменение исходных файлов.</p>\n' +
  `<p><a href="${escapeAttr(base ? `${base}/` : '/')}">К началу документации</a></p>\n` +
  '</article></main>\n</body>\n</html>\n';

/* ------------------------------------------------------------------ сборка */

/** Базовый адрес: без него `canonical` и `sitemap.xml` не печатаются */
function readBase(argv) {
  const flag = argv.indexOf('--base');
  const raw = flag === -1 ? process.env.DOCS_BASE : argv[flag + 1];

  if (!raw) {
    return '';
  }

  if (!/^https?:\/\//.test(raw)) {
    throw new BuildError(`--base ждёт адрес с протоколом, получено: ${raw}`);
  }

  return raw.replace(/\/$/, '');
}

function build(base) {
  const layout = readFileSync(join(HERE, 'layout.html'), 'utf8');
  const homeLayout = readFileSync(join(HERE, 'home.html'), 'utf8');
  const styles = readFileSync(join(HERE, 'styles.css'), 'utf8');
  const script = readFileSync(join(HERE, 'app.js'), 'utf8');

  const pages = readModel();

  // Каталог собирается заново: файлы прошлой сборки иначе остались бы лежать
  // в выводе и открываться по прежним адресам
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const byId = new Map(pages.map((page) => [page.id, page]));
  const byPath = new Map();
  for (const page of pages) {
    byPath.set(page.path, page);
    // Ссылка на каталог ведёт в его оглавление: `../packages/nestling.app/`
    // и `../design/` встречаются в текстах наравне со ссылками на файл
    if (basename(page.path) === 'README.md') {
      byPath.set(dirname(page.path), page);
    }
  }

  const options = { layout, homeLayout, styles, script, byId, byPath, base, pages };

  for (const [index, page] of pages.entries()) {
    const parts = { prev: pages[index - 1], next: pages[index + 1] };
    const dir = join(OUT, ...page.route);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderTreePage(page, parts, options));
  }

  writeFileSync(join(OUT, SINGLE_FILE), renderSingleFile(pages, options));
  writeFileSync(join(OUT, 'search-index.json'), searchIndex(pages));
  writeFileSync(join(OUT, 'favicon.svg'), FAVICON);
  writeFileSync(join(OUT, 'robots.txt'), robotsTxt(base));
  writeFileSync(join(OUT, '404.html'), notFoundHtml(styles, base));

  if (base) {
    writeFileSync(join(OUT, 'sitemap.xml'), sitemapXml(pages, base));
  }

  console.log(`  docs/.site/ — страниц: ${pages.length}`);
  console.log(`  docs/.site/${SINGLE_FILE} — вся документация одним файлом`);
  if (base) {
    console.log(`  docs/.site/sitemap.xml — адреса от ${base}`);
  }
}

/** Ошибка документации печатается строкой: стектрейс генератора не нужен */
function buildOrExit(base) {
  try {
    build(base);
  } catch (error) {
    if (error instanceof BuildError) {
      console.error(`Сборка сайта не удалась: ${error.message}`);
      process.exit(1);
    }

    throw error;
  }
}

const base = readBase(process.argv);

console.log('Сборка сайта:');
buildOrExit(base);

if (process.argv.includes('--watch')) {
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log('Изменения, пересобираю:');
      try {
        build(base);
      } catch (error) {
        console.error(error.message);
      }
    }, 50);
  };

  // Папка слушается целиком, а `packages/` — только по README пакетов: в
  // каталогах пакетов лежат `dist` и `node_modules`, и рекурсивный слушатель
  // пересобирал бы сайт на каждую сборку кода
  for (const source of SECTIONS) {
    const path = join(ROOT, source.path);

    if (source.kind === 'folder') {
      watch(path, { recursive: true }, rebuild);
    } else if (source.kind === 'packages') {
      for (const name of packageDirs(path)) {
        watch(join(path, name, 'README.md'), rebuild);
      }
    } else {
      watch(path, rebuild);
    }
  }

  watch(join(ROOT, PACKAGES_OUTLINE), rebuild);
  watch(HERE, { recursive: true }, rebuild);

  // Дерево путей по `file://` не открывается: `/guide/01-first-service/`
  // браузер ищет на диске от корня. Поэтому сервер, а не подсказка «откройте
  // файл». Пакет внутренний и лежит в этом же репозитории
  const { StaticServer } = await import('@nestlingjs/common.static-server');
  const port = Number(process.env.DOCS_PORT ?? 4173);
  const server = new StaticServer({
    port,
    staticDir: OUT,
    indexFile: 'index.html',
    disableCache: true,
  });

  await server.start();

  const watched = SECTIONS.map((source) => source.path).join(', ');
  console.log(`\n  http://localhost:${port}/ — дерево страниц`);
  console.log(`  http://localhost:${port}/${SINGLE_FILE} — один файл`);
  console.log(`\nЖду изменений в ${watched} и scripts/site/ …  (Ctrl+C — выход)`);
}
