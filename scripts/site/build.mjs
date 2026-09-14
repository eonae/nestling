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

import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  PACKAGES_OUTLINE,
  PACKAGE_GROUPS,
  SECTIONS,
  TOP_LINKS,
  UI,
  readmeName,
  sourcePath,
} from './sections.mjs';

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

/** Текст источника: отсутствие файла называет недостающий путь, а не ENOENT */
function readSource(path) {
  if (!existsSync(path)) {
    throw new BuildError(`${rel(path)} не найден: у раздела нет файла на этом языке`);
  }

  return readFileSync(path, 'utf8');
}

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
 * Правила языков кода: регулярное выражение с группами и классы этих групп.
 *
 * Языков четыре, потому что столько встречается в документации: примеры на
 * TypeScript, команды на bash, ответы и конфиги на json.
 */
const SYNTAX = {
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

SYNTAX.javascript = SYNTAX.typescript;

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
  const rules = SYNTAX[lang];

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

/** Виды врезок: имя контейнера называет вид, оформление даёт тема */
const NOTE_KINDS = ['note', 'tip', 'important', 'warning', 'caution'];

/** Имена контейнеров, которые знает генератор */
const CONTAINERS = [...NOTE_KINDS, 'cards', 'card'];

/** Место контейнера в тексте: его называет сообщение об ошибке */
const placeOf = (token, env) =>
  `${env.file ?? ''}${token.map ? `:${token.map[0] + 1}` : ''}`;

/**
 * :::warning Порядок важен → <div class="note note-warning">
 * :::tip                   → заголовком печатается имя вида
 */
for (const kind of NOTE_KINDS) {
  md.use(container, kind, {
    validate: (params) => new RegExp(`^${kind}(\\s|$)`).test(params.trim()),
    render(tokens, idx) {
      if (tokens[idx].nesting !== 1) return '</div>\n';
      const title = tokens[idx].info.trim().slice(kind.length).trim();
      const label = title || kind[0].toUpperCase() + kind.slice(1);

      return (
        `<div class="note note-${kind}">\n` +
        `<span class="note-t">${md.renderInline(label)}</span>\n`
      );
    },
  });
}

/** ::::cards … :::: — сетка карточек. */
md.use(container, 'cards', {
  validate: (params) => params.trim() === 'cards',
  render: (tokens, idx) =>
    tokens[idx].nesting === 1 ? '<div class="grid">\n' : '</div>\n',
});

/** :::card Заголовок — одна карточка внутри ::::cards. */
md.use(container, 'card', {
  validate: (params) => /^card(\s|$)/.test(params.trim()),
  render(tokens, idx, options, env) {
    if (tokens[idx].nesting !== 1) return '</div>\n';
    const title = tokens[idx].info.trim().slice('card'.length).trim();

    if (!title) {
      throw new BuildError(
        `${placeOf(tokens[idx], env)}: у :::card обязателен заголовок`,
      );
    }

    return `<div class="card"><h3 class="card-t">${md.renderInline(title)}</h3>`;
  },
});

/**
 * Неизвестное имя контейнера останавливает сборку.
 *
 * Нераспознанный `:::` markdown-it печатает абзацем: опечатка в имени
 * вида тихо превратила бы врезку в строку с двоеточиями.
 */
md.use(container, 'unknown', {
  validate: (params) => {
    const name = params.trim().split(/\s/)[0];

    return Boolean(name) && !CONTAINERS.includes(name);
  },
  render(tokens, idx, options, env) {
    if (tokens[idx].nesting !== 1) return '';
    const name = tokens[idx].info.trim().split(/\s/)[0];

    throw new BuildError(
      `${placeOf(tokens[idx], env)}: неизвестный контейнер ':::${name}'. ` +
        `Известны: ${CONTAINERS.join(', ')}`,
    );
  },
});

/**
 * Первая цитата раздела — плашка «сверено с кодом».
 *
 * Плашка открывает раздел и говорит, чему верить на этой странице: у
 * главы это сверка с примером, у design-дока — целевое состояние, у
 * README пакета — статус. Остальные цитаты остаются цитатами.
 */
md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
  if (!env.metaShown) {
    tokens[idx].attrJoin('class', 'meta');
    env.metaShown = true;
  }

  return self.renderToken(tokens, idx, options, env);
};

/**
 * Первая строка-комментарий с путём становится подписью блока.
 *
 * Глава начинает сниппет строкой `// src/app.ts`: подпись называет путь в
 * проекте читателя. Путь переносится дословно и не разбирается — сборка
 * не проверяет, что он существует. Строка остаётся в коде: скопированный
 * сниппет не теряет адрес.
 */
function fileOf(code) {
  const [first] = code.split('\n');
  const m = /^\s*\/\/\s*([\w./@-]+\.[a-z]+)\s*$/.exec(first ?? '');

  return m ? m[1] : '';
}

/**
 * Шапка блока кода: подпись файла, язык и кнопка копирования.
 *
 * Подписи может не быть, языка — тоже; кнопка стоит всегда, потому что
 * копируют любой блок. Её подпись приходит из `env`: страница английского
 * дерева русских слов не показывает.
 */
function renderCodeHead(file, lang, ui) {
  const name = file ? `<span class="fname">${escapeHtml(file)}</span>` : '';
  const label = `<span class="lang">${lang ? escapeHtml(lang) : ''}</span>`;
  const copy = `<button class="copy" type="button">${escapeHtml(ui.copy)}</button>`;

  return `<div class="code-head">${name}${label}${copy}</div>`;
}

/**
 * ```ts            → <div class="code" data-lang="typescript">
 * Подпись `data-file` берётся из первой строки-комментария сниппета.
 * Шапка блока и разметка подсветки пишутся сразу: браузеру доделывать
 * нечего.
 */
md.renderer.rules.fence = (tokens, idx, options, env) => {
  const info = tokens[idx].info.trim();
  const alias = info.split(/\s/)[0];
  const lang = LANG_ALIAS[alias] ?? alias;
  const code = tokens[idx].content.replace(/\n$/, '');
  const file = fileOf(code);
  const fileAttr = file ? ` data-file="${escapeAttr(file)}"` : '';
  const langAttr = lang ? ` data-lang="${escapeAttr(lang)}"` : '';

  return (
    `<div class="code"${fileAttr}${langAttr}>` +
    renderCodeHead(file, lang, env.ui) +
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

/* ------------------------------------------------------------------ языки */

/** Слово «часть» в заголовке группы: оглавление написано на своём языке */
const PART = '(?:Часть|Part)';

/** Текст поля `sections.mjs` на языке страницы */
const textOf = (value, lang) => (value ? value[lang] : undefined);

/** Имя группы пакетов на языке: заголовок без перевода останавливает сборку */
function translateGroup(heading, lang, outlinePath) {
  if (lang === 'ru') {
    return heading;
  }

  const translated = PACKAGE_GROUPS[heading];

  if (!translated) {
    throw new BuildError(
      `${rel(outlinePath)}: у группы «${heading}» нет английского имени — ` +
        'добавьте его в PACKAGE_GROUPS файла scripts/site/sections.mjs',
    );
  }

  return translated;
}

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
 * Группа — заголовок `## Часть N. …` и его английская пара `## Part N. …`;
 * файлы группы — строки таблицы под ним: первая ячейка несёт ссылку на файл.
 * У папки без таких заголовков группа одна и названа в `sections.mjs`.
 *
 * @returns Файлы в порядке README: `{ slug, group }`
 */
function readOutline(readme, readmePath, fallbackGroup) {
  const parted = new RegExp(`^##\\s+${PART}\\s+\\d+\\.`, 'm').test(readme);
  const files = [];
  let group;

  for (const line of readme.split('\n')) {
    const heading = new RegExp(
      `^##\\s+(${PART}\\s+\\d+\\.[^\\n]*)\\s*$`,
    ).exec(line);
    if (heading) {
      group = heading[1].replace(/\.$/, '');
      continue;
    }

    const cell = /^\|\s*\[[^\]]+\]\(\.\/([\w.-]+)\.md\)/.exec(line);
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
 * Оглавление пакетов лежит в русском файле о ведении репозитория, поэтому
 * английские имена групп приходят из `PACKAGE_GROUPS`.
 *
 * @returns Каталоги в порядке карты: `{ slug, group }`
 */
function readPackagesOutline(outlinePath, lang) {
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
      group = translateGroup(heading[1], lang, outlinePath);
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

/**
 * Один раздел модели: всё, что печать берёт из исходного файла.
 *
 * `route` начинается с префикса языка, `local` — тот же адрес без него.
 * По `local` раздел находит свою пару в другом языке: имена файлов в паре
 * совпадают, и адреса различаются только префиксом.
 */
function makePage({ kind, section, slug, path, source, group, badge, lang, directory }) {
  const headings = headingsOf(source);
  const local = routeOf(kind, section, slug);

  return {
    kind,
    section,
    slug,
    group,
    badge,
    directory,
    lang: lang.code,
    prefix: lang.prefix,
    path,
    dir: dirname(path),
    source,
    title: titleOf(source, path),
    summary: summaryOf(source),
    headings,
    heads: headings.filter((heading) => heading.level === 2),
    local,
    route: [...lang.prefix, ...local],
    id: idOf(kind, section, slug),
  };
}

/**
 * Разворачивает `sections.mjs` в плоский список разделов одного языка.
 *
 * Путь источника записан по русскому оригиналу, файл языка даёт
 * `sourcePath`: английский текст лежит зеркалом в `docs/en/`, а README
 * пакета различается именем файла.
 *
 * Слаг уникален внутри своего источника: `/design/container/` и
 * `/reference/nestling.container/` не спорят, потому что секции у них
 * разные. Совпадение внутри источника останавливает сборку.
 *
 * @returns Разделы в порядке `sections.mjs`
 */
function readModel(lang) {
  const pages = [];

  for (const source of SECTIONS) {
    const path = join(ROOT, sourcePath(source.path, lang.code));
    const group = textOf(source.group, lang.code);
    const badge = textOf(source.badge, lang.code);
    const before = pages.length;

    if (source.kind === 'home' || source.kind === 'page') {
      pages.push(
        makePage({
          kind: source.kind,
          section: '',
          slug: basename(source.path, '.md'),
          path,
          source: readSource(path),
          group,
          badge,
          lang,
        }),
      );
    } else if (source.kind === 'folder') {
      const readmePath = join(path, 'README.md');
      const readme = readSource(readmePath);
      const entries = readOutline(readme, readmePath, group);

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
          group,
          badge,
          lang,
          directory: path,
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
            source: readSource(filePath),
            group: entry.group,
            badge,
            lang,
          }),
        );
      }
    } else if (source.kind === 'packages') {
      const outlinePath = join(ROOT, PACKAGES_OUTLINE);
      const entries = readPackagesOutline(outlinePath, lang.code);

      assertComplete(
        entries,
        packageDirs(path),
        outlinePath,
        (slug) => `называет каталог '${slug}', которого нет в ${rel(path)}`,
        (slug) => `${rel(join(path, slug))}`,
      );

      for (const entry of entries) {
        const directory = join(path, entry.slug);

        pages.push(
          makePage({
            kind: 'doc',
            section: source.section,
            slug: entry.slug,
            path: join(directory, readmeName(lang.code)),
            source: readSource(join(directory, readmeName(lang.code))),
            group: entry.group,
            badge,
            lang,
            directory,
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

/** Путь от адреса раздела к каталогу: пустая строка — тот же каталог */
function routeUp(from, to) {
  const path = posix.relative(from.join('/'), to.join('/'));

  return path ? `${path}/` : '';
}

/** Путь от адреса одного раздела к адресу другого: оба кончаются каталогом */
const routeHref = (from, to) => routeUp(from, to) || './';

/** Путь от адреса раздела к корню вывода: им собираются адреса файлов сайта */
const routeRoot = (from) => routeUp(from, []);

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
  langRoot: (from) => routeUp(from.route, from.prefix),
};

const SINGLE = {
  name: 'single',
  headingId: (page, anchor) => `${page.id}${ANCHOR_SEP}${anchor}`,
  href: (from, to, anchor) =>
    anchor ? `#${to.id}${ANCHOR_SEP}${anchor}` : `#${to.id}`,
  root: () => '',
  langRoot: () => '',
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

/**
 * Версия в шапке сайта: версия пакета `@nestlingjs/app`.
 *
 * Это та версия, которую читатель ставит себе; корневой `package.json`
 * не публикуется, и его версия ничего читателю не говорит.
 */
function appVersion() {
  const path = join(ROOT, 'packages', 'nestling.app', 'package.json');

  return `v${JSON.parse(readFileSync(path, 'utf8')).version}`;
}

const VERSION = appVersion();

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
function renderPager({ prev, next }, from, form, ui) {
  const link = (page, dir, cls) =>
    `    <a${cls ? ` class="${cls}"` : ''} href="${escapeAttr(form.href(from, page))}">\n` +
    `      <div class="dir">${escapeHtml(dir)}</div>\n` +
    `      <div class="ttl">${escapeHtml(page.title)}</div>\n` +
    `    </a>`;

  const parts = [prev ? link(prev, ui.prev, '') : '    <span></span>'];
  if (next) {
    parts.push(link(next, ui.next, 'next'));
  }

  return `  <nav class="pager">\n${parts.join('\n')}\n  </nav>\n`;
}

/** Бейдж источника в шапке раздела */
const renderBadge = (page) =>
  page.badge ? `<p class="badge">${escapeHtml(page.badge)}</p>\n` : '';

/** Быстрые ссылки шапки: разделы, которые читатель ищет чаще прочих */
function renderTopLinks(byId, from, form, lang) {
  return TOP_LINKS.map(({ id, label }) => {
    const page = byId.get(id);

    return page
      ? `  <a href="${escapeAttr(form.href(from, page))}">` +
          `${escapeHtml(label[lang])}</a>`
      : '';
  })
    .filter(Boolean)
    .join('\n');
}

/** Подсказка сочетания: на не-Apple раскладку её меняет скрипт страницы */
const SEARCH_KEY = '⌘K';

/** Лупа в поле поиска */
const SEARCH_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<circle cx="7" cy="7" r="4.6" stroke="currentColor" stroke-width="1.5"/>' +
  '<path d="m10.6 10.6 3 3" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round"/></svg>';

/**
 * Поле поиска: индекс подгружается по первому обращению, сервер не нужен.
 *
 * Подсказка сочетания стоит в поле: `⌘K` и `Ctrl+K` открывают поиск с
 * любой страницы, и читателю не нужно искать это сочетание опытом.
 */
const searchBox = (ui) =>
  '  <div class="search">\n' +
  `    <div class="search-field">${SEARCH_ICON}` +
  `<input id="q" type="search" placeholder="${escapeAttr(ui.search)}" ` +
  `autocomplete="off" aria-label="${escapeAttr(ui.search)}">` +
  `<kbd>${SEARCH_KEY}</kbd></div>\n` +
  '    <div class="results" id="results" hidden></div>\n' +
  '  </div>';

/**
 * Переключатель языка: тот же раздел в другом языке.
 *
 * Адрес отличается от адреса страницы одним префиксом. Язык, в котором
 * раздела нет, в переключатель не попадает: ссылка вела бы в 404.
 */
function renderLangs(page, present, ui) {
  const key = page.local.join('/');

  const items = LANGUAGES.filter(
    (lang) => lang.code === page.lang || present.get(lang.code)?.has(key),
  ).map((lang) => {
    const href = routeHref(page.route, [...lang.prefix, ...page.local]);
    const current = lang.code === page.lang;

    return (
      `    <a class="lang${current ? ' active' : ''}" href="${escapeAttr(href)}"` +
      `${current ? ' aria-current="true"' : ''} hreflang="${lang.code}" ` +
      `title="${escapeAttr(lang.label)}">${escapeHtml(lang.code.toUpperCase())}</a>`
    );
  });

  return (
    `  <div class="langs" role="group" aria-label="${escapeAttr(ui.language)}">\n` +
    `${items.join('\n')}\n  </div>`
  );
}

/**
 * Знак Nestling: птенец в скорлупе, взятый из логотипа без надписи.
 *
 * Квадрат 64×64, одна фигура одного цвета. Глаз вырезан отверстием
 * контура и показывает фон, поэтому знак не зависит от темы и красится
 * одним `fill`.
 */
const GLYPH =
  'M40.81 1.37C45.53 2.59 48.86 5.46 50.7 9.89' +
  'C51.26 11.21 51.42 12.08 51.5 14.22' +
  'C51.57 16.51 51.5 17.12 50.92 18.89' +
  'C50.55 19.97 49.83 21.53 49.36 22.29' +
  'C48.44 23.72 46.3 25.88 45.27 26.43' +
  'C44.95 26.59 44.69 26.91 44.69 27.15' +
  'C44.69 27.86 43.34 30.73 42.16 32.55' +
  'C41.5 33.53 40.26 35.01 39.41 35.8' +
  'C37.59 37.46 34.43 39.12 32.77 39.28' +
  'C31.63 39.41 31.63 39.39 30.44 37.78' +
  'C27.73 34.06 20.5 27.36 16.25 24.64' +
  'C15.51 24.16 14.88 23.61 14.88 23.43' +
  'C14.88 22.29 18.99 18.15 21.1 17.17' +
  'C21.58 16.96 21.69 16.59 21.82 15.14' +
  'C22.21 10.47 24.93 6.04 29.07 3.4C31.18 2.06 31.87 1.77 34.14 1.29' +
  'C36.56 0.77 38.49 0.79 40.81 1.37ZM59.01 13.38' +
  'C59.7 13.77 60.25 14.19 60.25 14.27' +
  'C60.25 14.38 59.38 14.96 58.33 15.59' +
  'C57.3 16.2 56.09 16.94 55.64 17.23L54.85 17.73L54.85 14.22' +
  'L54.85 10.74L56.3 11.69C57.09 12.21 58.3 12.98 59.01 13.38Z' +
  'M5.14 24.06C11.19 26.12 16.78 29.86 22.4 35.54' +
  'C25.96 39.15 26.86 40.26 31.1 46.22' +
  'C35.56 52.5 40.47 56.09 46.64 57.62' +
  'C49.31 58.28 49.31 58.28 46.46 59.73' +
  'C41.71 62.15 37.3 63.21 31.89 63.21' +
  'C26.33 63.23 22.29 62.29 17.52 59.81' +
  'C10.97 56.43 6.12 51.36 2.93 44.61C0.82 40.15 0 35.98 0.16 30.44' +
  'C0.32 25.83 0.63 24.69 1.95 24.03C3.11 23.45 3.38 23.45 5.14 24.06' +
  'ZM62.68 25.62C63.68 26.62 64 32.42 63.29 36.64' +
  'C62.36 41.97 60.25 46.69 56.75 51.21' +
  'C55 53.42 54.34 53.74 51.55 53.74' +
  'C45.85 53.74 39.73 50.41 35.85 45.24' +
  'C34.35 43.24 34.16 42.82 34.74 42.82' +
  'C35.56 42.82 39.91 40.42 41.26 39.23' +
  'C42.08 38.52 43.37 37.01 44.16 35.88' +
  'C47.43 31.21 52.97 27.17 58.41 25.48' +
  'C60.6 24.82 61.94 24.85 62.68 25.62ZM41.81 8.34' +
  'C40.49 8.81 39.81 9.87 39.81 11.45' +
  'C39.81 12.53 39.94 12.85 40.63 13.56' +
  'C42.68 15.62 46.11 14.22 46.11 11.29C46.11 9.02 44 7.57 41.81 8.34' +
  'Z';

/** Марка в шапке: знак цветом текста — шапка задаёт ему акцент темы */
const MARK =
  '<svg class="mark" width="19" height="19" viewBox="0 0 64 64" ' +
  'fill="currentColor" aria-hidden="true">' +
  `<path d="${GLYPH}"/></svg>`;

/**
 * Тот же знак в иконке вкладки: оранжевый исходного рисунка на тёмной
 * плашке. Вкладка кладёт иконку на фон любой светлоты, и плашка держит
 * контраст сама.
 */
const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n' +
  '  <rect width="64" height="64" rx="13" fill="#0f0f0e"/>\n' +
  `  <path d="${GLYPH}" transform="translate(2.6 2.6) scale(0.92)" ` +
  'fill="#fb8227"/>\n' +
  '</svg>\n';

/**
 * Веб-шрифты темы: их подключает только дерево страниц.
 *
 * `nestling-docs.html` открывают из файловой системы без сети — ждать
 * недоступный ресурс ему незачем, и он остаётся на системном гротеске.
 */
const FONT_LINKS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
  'family=Geist:wght@400;500;600&amp;family=Geist+Mono&amp;display=swap">';

/* ------------------------------------------------------------- метаданные */

/**
 * Ссылки на пару языков одного раздела.
 *
 * Печатаются только с базовым адресом: относительный адрес в `hreflang`
 * смысла не имеет. Раздел, которого в другом языке нет, ссылок не несёт.
 */
function alternatesOf(page, base, present) {
  if (!base) {
    return [];
  }

  const key = page.local.join('/');
  const links = LANGUAGES.filter((lang) => present.get(lang.code)?.has(key)).map(
    (lang) => ({
      code: lang.code,
      url: absoluteUrl(base, [...lang.prefix, ...page.local]),
      default: Boolean(lang.default),
    }),
  );

  return links.length > 1 ? links : [];
}

/** `title`, `description`, Open Graph, favicon и адреса пары одной страницы */
function renderHead(page, { root, base, canonical, alternates, ui }) {
  const title = page.kind === 'home' ? ui.siteTitle : `${page.title} — ${SITE_NAME}`;
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

  for (const alternate of alternates) {
    tags.push(
      `<link rel="alternate" hreflang="${alternate.code}" ` +
        `href="${escapeAttr(alternate.url)}">`,
    );

    if (alternate.default) {
      tags.push(
        `<link rel="alternate" hreflang="x-default" href="${escapeAttr(alternate.url)}">`,
      );
    }
  }

  return tags.join('\n');
}

/** Адрес страницы от базового адреса сайта */
const absoluteUrl = (base, route) =>
  route.length === 0 ? `${base}/` : `${base}/${route.join('/')}/`;

/* ------------------------------------------------------------------ печать */

/** Разметка одного раздела: бейдж, статья и пейджер */
function renderArticle(page, neighbours, byPath, form, ui) {
  const text = rewriteLinks(page.source, page, byPath, form);
  const env = { file: rel(page.path), ui };
  const article = anchorHeadings(md.render(text, env), page, form);
  const pager = page.kind === 'home' ? '' : renderPager(neighbours, page, form, ui);

  return renderBadge(page) + article + pager;
}

/* ------------------------------------------------------- стартовая страница */

/**
 * Блоки текста верхнего уровня: заголовок, абзац, список, забор кода,
 * контейнер. Внутренние токены остаются внутри своего блока.
 */
function topBlocks(tokens) {
  const blocks = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.level !== 0 || token.nesting === -1) {
      continue;
    }

    if (token.nesting === 0) {
      blocks.push({ type: token.type, tag: token.tag, tokens: [token] });
      continue;
    }

    let depth = 0;
    let end = i;

    while (end < tokens.length) {
      depth += tokens[end].nesting;
      if (depth === 0) break;
      end++;
    }

    blocks.push({ type: token.type, tag: token.tag, tokens: tokens.slice(i, end + 1) });
    i = end;
  }

  return blocks;
}

/** Ссылка markdown: подпись и адрес */
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

/** Абзац, в котором кроме ссылок ничего нет: он даёт кнопки первого экрана */
function ctaLinks(block) {
  if (block.type !== 'paragraph_open') {
    return null;
  }

  const content = block.tokens[1]?.content ?? '';

  if (content.replace(LINK_RE, '').trim() !== '') {
    return null;
  }

  const links = [...content.matchAll(LINK_RE)];

  return links.length > 0 ? links : null;
}

/** Кнопки первого экрана: первая ссылка — главная, остальные — контуром */
const renderCta = (links, env) =>
  links
    .map(
      ([, label, href], index) =>
        `    <a class="${index === 0 ? 'btn' : 'btn-ghost'}" ` +
        `href="${escapeAttr(href)}">${md.renderInline(label, env)}</a>`,
    )
    .join('\n');

/**
 * Части стартовой страницы, разобранные из `docs/index.md`.
 *
 * Состав страницы задаёт текст, а не шаблон. Заголовок первого уровня и
 * первый абзац открывают первый экран, абзац из одних ссылок даёт
 * кнопки, первый забор кода — пример рядом с ними, `::::cards` —
 * принципы. Раздел `##` со списком становится колонкой входов, раздел
 * без списка — строкой статуса под ними.
 */
function homeParts(text, page, form, env) {
  const tokens = md.parse(text, env);
  const render = (group) => md.renderer.render(group, md.options, env);
  const headings = [...page.headings];
  const sections = [];

  const parts = { title: '', lead: '', cta: '', example: '', principles: '' };

  for (const block of topBlocks(tokens)) {
    if (block.tag === 'h1') {
      parts.title = md.renderInline(block.tokens[1].content, env);
      continue;
    }

    if (block.tag === 'h2' || block.tag === 'h3') {
      const heading = headings.shift();

      if (heading && !block.tokens[0].attrGet('id')) {
        block.tokens[0].attrSet('id', form.headingId(page, heading.anchor));
      }
    }

    if (block.tag === 'h2') {
      sections.push({ heading: render(block.tokens), body: '', list: false });
      continue;
    }

    // Всё, что стоит после первого `##`, принадлежит своему разделу
    const section = sections.at(-1);

    if (section) {
      section.body += render(block.tokens);
      section.list ||= block.type === 'bullet_list_open' || block.type === 'ordered_list_open';
      continue;
    }

    if (block.type === 'container_cards_open') {
      parts.principles = render(block.tokens);
      continue;
    }

    if (block.type === 'fence') {
      parts.example ||= render(block.tokens);
      continue;
    }

    const links = ctaLinks(block);

    if (links) {
      parts.cta = renderCta(links, env);
      continue;
    }

    if (!parts.lead) {
      parts.lead = render(block.tokens).replace('<p>', () => '<p class="lead">');
    }
  }

  return {
    ...parts,
    columns: sections.filter((section) => section.list),
    foot: sections.filter((section) => !section.list),
  };
}

/** Места лендинга: их наполняет `docs/index.md`, разобранный на части */
function fillHome(html, page, byPath, ui) {
  const text = rewriteLinks(page.source, page, byPath, TREE);
  const env = { file: rel(page.path), ui };
  const parts = homeParts(text, page, TREE, env);

  const columns = parts.columns
    .map((section) => `  <div>\n${section.heading}${section.body}  </div>`)
    .join('\n');
  const foot = parts.foot.map((section) => section.heading + section.body).join('');

  let filled = fill(html, '{{title}}', parts.title);
  filled = fill(filled, '{{lead}}', parts.lead);
  filled = fill(filled, '{{cta}}', parts.cta);
  filled = fill(filled, '{{example}}', parts.example);
  filled = fill(filled, '{{principles}}', parts.principles);
  filled = fill(filled, '{{cols}}', columns);

  return fill(filled, '{{foot}}', foot);
}

function renderTreePage(page, parts, options) {
  const { layout, homeLayout, styles, script, byId, byPath, base, ui, present } =
    options;
  const home = page.kind === 'home';
  const template = home ? homeLayout : layout;
  const root = TREE.root(page);
  const canonical = base ? absoluteUrl(base, page.route) : '';
  const alternates = alternatesOf(page, base, present);

  let html = fill(
    template,
    '{{head}}',
    `${FONT_LINKS}\n${renderHead(page, { root, base, canonical, alternates, ui })}`,
  );
  html = fill(html, '{{styles}}', styles);
  html = fill(html, '{{lang}}', escapeAttr(page.lang));
  html = fill(html, '{{root}}', escapeAttr(root));
  html = fill(html, '{{langroot}}', escapeAttr(TREE.langRoot(page)));
  html = fill(html, '{{mode}}', 'tree');
  html = fill(html, '{{home}}', escapeAttr(TREE.href(page, byId.get('home'))));
  html = fill(html, '{{mark}}', MARK);
  html = fill(html, '{{version}}', escapeHtml(VERSION));
  html = fill(html, '{{menu}}', escapeAttr(ui.menu));
  html = fill(html, '{{themelabel}}', escapeAttr(ui.theme));
  html = fill(html, '{{langs}}', renderLangs(page, present, ui));
  html = fill(html, '{{toplinks}}', renderTopLinks(byId, page, TREE, page.lang));
  html = fill(html, '{{search}}', searchBox(ui));

  if (home) {
    html = fillHome(html, page, byPath, ui);
  } else {
    html = fill(html, '{{sidebar}}', renderSidebar(options.pages, page, TREE));
    html = fill(html, '{{article}}', renderArticle(page, parts, byPath, TREE, ui));
  }

  html = fill(html, '{{script}}', uiScript(ui) + script);

  return html;
}

function renderSingleFile(pages, options) {
  const { layout, styles, script, byId, byPath, ui } = options;
  const start = byId.get('home');

  const body = pages
    .map((page, index) => {
      const article = renderArticle(
        page,
        { prev: pages[index - 1], next: pages[index + 1] },
        byPath,
        SINGLE,
        ui,
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
    `<title>${escapeHtml(ui.siteTitle)}</title>\n` +
      `<meta name="description" content="${escapeAttr(start.summary)}">\n` +
      `<link rel="icon" href="${escapeAttr(icon)}" type="image/svg+xml">`,
  );
  html = fill(html, '{{styles}}', styles);
  html = fill(html, '{{lang}}', escapeAttr(start.lang));
  html = fill(html, '{{root}}', '');
  html = fill(html, '{{langroot}}', '');
  html = fill(html, '{{mode}}', 'single');
  html = fill(html, '{{home}}', `#${escapeAttr(start.id)}`);
  html = fill(html, '{{mark}}', MARK);
  html = fill(html, '{{version}}', escapeHtml(VERSION));
  html = fill(html, '{{menu}}', escapeAttr(ui.menu));
  html = fill(html, '{{themelabel}}', escapeAttr(ui.theme));
  html = fill(html, '{{langs}}', '');
  html = fill(html, '{{toplinks}}', renderTopLinks(byId, start, SINGLE, start.lang));
  html = fill(html, '{{search}}', '');
  html = fill(html, '{{sidebar}}', renderSidebar(pages, null, SINGLE));
  html = fill(html, '{{article}}', body);
  html = fill(html, '{{script}}', uiScript(ui) + script);

  return html;
}

/** Подписи оформления, которые читает встроенный скрипт страницы */
const uiScript = (ui) => `var NESTLING_UI = ${JSON.stringify(ui)};\n`;

/* ------------------------------------------------------- файлы публикации */

const robotsTxt = (base) =>
  ['User-agent: *', 'Allow: /', base ? `Sitemap: ${base}/sitemap.xml` : '']
    .filter(Boolean)
    .join('\n') + '\n';

/**
 * Карта сайта: адреса разделов всех языков.
 *
 * У раздела, существующего в паре, рядом с адресом стоят `xhtml:link` на
 * оба языка: поисковику не нужно догадываться, что это один текст.
 */
const sitemapXml = (models, base, present) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
  'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
  models
    .flatMap(({ pages }) =>
      pages.map((page) => {
        const alternates = alternatesOf(page, base, present)
          .map(
            (alternate) =>
              `\n    <xhtml:link rel="alternate" hreflang="${alternate.code}" ` +
              `href="${escapeHtml(alternate.url)}"/>`,
          )
          .join('');

        return (
          `  <url><loc>${escapeHtml(absoluteUrl(base, page.route))}</loc>` +
          `${alternates}${alternates ? '\n  ' : ''}</url>`
        );
      }),
    )
    .join('\n') +
  '\n</urlset>\n';

/**
 * Индекс поиска: заголовок, адрес, заголовки второго уровня и текст.
 *
 * Адрес записан от корня языка: индекс лежит рядом со стартовой страницей
 * своего языка, и страница считает адреса результатов от неё.
 */
const searchIndex = (pages) =>
  JSON.stringify(
    pages.map((page) => ({
      title: page.title,
      group: page.group ?? '',
      path: page.local.length === 0 ? '' : `${page.local.join('/')}/`,
      heads: page.heads.map((head) => ({ label: head.label, anchor: head.anchor })),
      text: plainTextOf(page.source).slice(0, 4000),
    })),
  );

/**
 * Страница «не найдено»: её отдаёт хостинг по любому неизвестному адресу.
 *
 * Страница одна на сайт и написана на языке по умолчанию: адрес, по
 * которому её показали, языка не называет. Оформление встроено в файл —
 * она открывается из любого подпути.
 */
const notFoundHtml = (styles, base) => {
  const ui = UI[DEFAULT_LANGUAGE];
  const home = escapeAttr(base ? `${base}/` : '/');

  return (
    `<!DOCTYPE html>\n<html lang="${DEFAULT_LANGUAGE}" data-theme="">\n<head>\n` +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>${escapeHtml(ui.notFoundTitle)} — ${SITE_NAME}</title>\n` +
    '<meta name="robots" content="noindex">\n' +
    `${FONT_LINKS}\n` +
    `<style>\n${styles}\n</style>\n</head>\n<body class="home">\n` +
    '<header class="topbar">\n' +
    `  <a class="brand" href="${home}">${MARK} Nestling ` +
    `<span class="ver">${escapeHtml(VERSION)}</span></a>\n` +
    '</header>\n' +
    '<main class="content"><div class="home-wrap notfound">' +
    '<article class="article">\n' +
    `<h1>${escapeHtml(ui.notFoundHead)}</h1>\n` +
    `<p>${escapeHtml(ui.notFoundText)}</p>\n` +
    `<p><a href="${home}">${escapeHtml(ui.notFoundLink)}</a></p>\n` +
    '</article></div></main>\n</body>\n</html>\n'
  );
};

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

/** Адреса разделов, по которым язык находит пару: адрес без префикса языка */
const localRoutes = (pages) => new Set(pages.map((page) => page.local.join('/')));

/**
 * Разделы одного языка по пути файла.
 *
 * Ссылка на каталог ведёт в раздел, который его представляет:
 * `../packages/nestling.app/` и `../design/` встречаются в текстах наравне
 * со ссылками на файл.
 */
function indexByPath(pages) {
  const byPath = new Map();

  for (const page of pages) {
    byPath.set(page.path, page);

    if (page.directory) {
      byPath.set(page.directory, page);
    }
  }

  return byPath;
}

function build(base) {
  const layout = readFileSync(join(HERE, 'layout.html'), 'utf8');
  const homeLayout = readFileSync(join(HERE, 'home.html'), 'utf8');
  const styles = readFileSync(join(HERE, 'styles.css'), 'utf8');
  const script = readFileSync(join(HERE, 'app.js'), 'utf8');

  const models = LANGUAGES.map((lang) => ({ lang, pages: readModel(lang) }));
  const present = new Map(
    models.map(({ lang, pages }) => [lang.code, localRoutes(pages)]),
  );

  // Каталог собирается заново: файлы прошлой сборки иначе остались бы лежать
  // в выводе и открываться по прежним адресам
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  for (const { lang, pages } of models) {
    const byId = new Map(pages.map((page) => [page.id, page]));
    const options = {
      layout,
      homeLayout,
      styles,
      script,
      byId,
      byPath: indexByPath(pages),
      base,
      pages,
      present,
      ui: UI[lang.code],
    };

    for (const [index, page] of pages.entries()) {
      const parts = { prev: pages[index - 1], next: pages[index + 1] };
      const dir = join(OUT, ...page.route);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.html'), renderTreePage(page, parts, options));
    }

    const langDir = join(OUT, ...lang.prefix);
    writeFileSync(join(langDir, SINGLE_FILE), renderSingleFile(pages, options));
    writeFileSync(join(langDir, 'search-index.json'), searchIndex(pages));
  }

  writeFileSync(join(OUT, 'favicon.svg'), FAVICON);
  writeFileSync(join(OUT, 'robots.txt'), robotsTxt(base));
  writeFileSync(join(OUT, '404.html'), notFoundHtml(styles, base));
  // Pages без этого файла прячет каталоги, начинающиеся с подчёркивания,
  // и прогоняет вывод через Jekyll
  writeFileSync(join(OUT, '.nojekyll'), '');

  if (base) {
    writeFileSync(join(OUT, 'sitemap.xml'), sitemapXml(models, base, present));
  }

  for (const { lang, pages } of models) {
    const where = lang.prefix.length ? `${lang.prefix.join('/')}/` : '';
    console.log(`  docs/.site/${where} — ${lang.label}, страниц: ${pages.length}`);
    console.log(`  docs/.site/${where}${SINGLE_FILE} — вся документация одним файлом`);
  }

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
  // пересобирал бы сайт на каждую сборку кода. Ветки языков слушаются обе:
  // правка перевода пересобирает сайт наравне с правкой оригинала
  const observe = (path, options) => {
    if (existsSync(path)) {
      watch(path, options ?? {}, rebuild);
    }
  };

  for (const source of SECTIONS) {
    for (const lang of LANGUAGES) {
      const path = join(ROOT, sourcePath(source.path, lang.code));

      if (source.kind === 'folder') {
        observe(path, { recursive: true });
      } else if (source.kind === 'packages') {
        for (const name of packageDirs(path)) {
          observe(join(path, name, readmeName(lang.code)));
        }
      } else {
        observe(path);
      }
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
  for (const lang of LANGUAGES.filter((lang) => lang.prefix.length)) {
    console.log(`  http://localhost:${port}/${lang.prefix.join('/')}/ — ${lang.label}`);
  }
  console.log(
    `\nЖду изменений в ${watched}, docs/en/ и scripts/site/ …  (Ctrl+C — выход)`,
  );
}
