#!/usr/bin/env node
/**
 * Сборка гайда: главы `docs/guide/*.md` → один файл `docs/.site/index.html`.
 *
 * Источник текста один — гайд. Состав и порядок разделов берутся из
 * `docs/guide/README.md`: заголовки `## Часть N. …` и `## Приложения`
 * дают группы сайдбара, строки таблиц под ними — главы. Каркас документа
 * и тема лежат рядом со скриптом, в `scripts/site/`; оформление,
 * поведение и подсветка кода попадают внутрь собранного файла, поэтому он
 * открывается в одиночку. Каталог `docs/.site/` — результат сборки, git
 * его не отслеживает.
 *
 *   yarn docs:build   — собрать один раз
 *   yarn docs:dev     — пересобирать при изменении docs/guide/ и scripts/site/
 */

import {
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import MarkdownIt from 'markdown-it';
import attrs from 'markdown-it-attrs';
import container from 'markdown-it-container';

/** Каталог скрипта: рядом лежат каркас документа и тема */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'docs', '.site');
const GUIDE = join(ROOT, 'docs', 'guide');

/** Единственный файл вывода */
const FILE = 'index.html';

/** Раздел README гайда: он открывает документ */
const INDEX_SLUG = 'index';

/**
 * Разделитель приставки главы в идентификаторе заголовка.
 *
 * Дефисов два, потому что имена глав и якоря содержат по одному:
 * одиночный не отличил бы приставку от продолжения имени.
 */
const ANCHOR_SEP = '--';

/** Алиасы языков: то, что пишем в ```-заборе → значение data-lang. */
const LANG_ALIAS = { ts: 'typescript', js: 'javascript' };

/* ------------------------------------------------------------------ утилиты */

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

/** Подстановка в каркас: значение попадает дословно, `$` в нём не спецсимвол */
const fill = (template, slot, value) => template.replace(slot, () => value);

/** Ошибка сборки: текст уже объясняет, что править в гайде */
class BuildError extends Error {}

/* --------------------------------------------------------------- подсветка */

/**
 * Подсветка выполняется здесь, а не в браузере.
 *
 * Файл пересылают, печатают и открывают в режиме чтения — везде, где
 * JavaScript выключен, разметка токенов должна уже лежать в HTML.
 * Язык гайда один, поэтому правил хватает семи групп.
 */
const KEYWORDS =
  'const|let|var|function|return|await|async|new|class|interface|type|import|export|' +
  'from|extends|implements|if|else|for|of|in|while|switch|case|default|break|continue|throw|' +
  'try|catch|finally|typeof|instanceof|as|void|this|super|yield|enum|public|private|protected|' +
  'readonly|static|declare|namespace|true|false|null|undefined|infer|keyof|satisfies';

const TOKENS = new RegExp(
  '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)' + // 1 комментарий
    '|(`(?:\\\\.|[^`\\\\])*`|\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*")' + // 2 строка
    '|(@[A-Za-z_]\\w*)' + // 3 декоратор
    '|\\b(\\d[\\d_]*\\.?\\d*)\\b' + // 4 число
    '|\\b(' + KEYWORDS + ')\\b' + // 5 ключевое слово
    '|\\b([A-Z][A-Za-z0-9_]*)\\b' + // 6 тип
    '|\\b([a-z_$][\\w$]*)(?=\\s*\\()', // 7 вызов
  'g',
);

/** Классы групп `TOKENS` по порядку */
const TOKEN_CLASSES = [
  'tok-com',
  'tok-str',
  'tok-deco',
  'tok-num',
  'tok-key',
  'tok-type',
  'tok-fn',
];

function highlight(code) {
  let out = '';
  let last = 0;
  let m;

  TOKENS.lastIndex = 0;
  while ((m = TOKENS.exec(code)) !== null) {
    if (m.index > last) {
      out += escapeHtml(code.slice(last, m.index));
    }

    const group = TOKEN_CLASSES.findIndex((_, i) => m[i + 1] !== undefined);
    out += `<span class="${TOKEN_CLASSES[group]}">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
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
    return `<div class="card"><span class="ic">${m[1]}</span><h3>${md.renderInline(m[2])}</h3>`;
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

  return (
    `<div class="code-head">${dots}${name}` +
    `<span class="lang">${escapeHtml(lang)}</span></div>`
  );
}

/**
 * ```ts            → <div class="code" data-lang="typescript">
 * Подпись `data-file` берётся из первой строки-комментария сниппета.
 * Шапка блока и разметка токенов пишутся сразу: браузеру доделывать нечего.
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
    renderCodeHead(file, lang || 'ts') +
    `<pre><code>${highlight(code)}</code></pre></div>\n`
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

/* ------------------------------------------------------- состав из README */

/**
 * Читает состав документа из README гайда.
 *
 * Группа — заголовок `## Часть N. …` или `## Приложения`; главы группы —
 * строки таблицы под ним: первая ячейка несёт ссылку на главу и её
 * заголовок.
 *
 * @returns Главы в порядке README: `{ slug, title, group }`
 */
function readOutline(readme) {
  const chapters = [];
  let group;

  for (const line of readme.split('\n')) {
    const heading = /^##\s+(Часть\s+\d+\.[^\n]*|Приложения)\s*$/.exec(line);
    if (heading) {
      group = heading[1].replace(/\.$/, '');
      continue;
    }

    const cell = /^\|\s*\[([^\]]+)\]\(\.\/([\w-]+)\.md\)/.exec(line);
    if (!cell) {
      continue;
    }

    if (!group) {
      throw new BuildError(
        `docs/guide/README.md: глава '${cell[2]}' стоит вне раздела ` +
          `«Часть N» или «Приложения»`,
      );
    }

    chapters.push({ slug: cell[2], title: cell[1], group });
  }

  if (chapters.length === 0) {
    throw new BuildError(
      'docs/guide/README.md: в таблицах нет ни одной ссылки на главу',
    );
  }

  return chapters;
}

/**
 * Сверяет состав README с файлами `docs/guide`.
 *
 * Расхождение в любую сторону — ошибка сборки: раздел без главы собрался
 * бы пустым, а глава без строки README не попала бы в навигацию и
 * осталась бы недоступной.
 */
function assertComplete(chapters) {
  const listed = new Set(chapters.map((chapter) => chapter.slug));

  const files = readdirSync(GUIDE)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => name.replace(/\.md$/, ''));

  for (const { slug } of chapters) {
    if (!files.includes(slug)) {
      throw new BuildError(
        `docs/guide/README.md называет главу '${slug}.md', которой нет в docs/guide`,
      );
    }
  }

  for (const file of files) {
    if (!listed.has(file)) {
      throw new BuildError(
        `docs/guide/${file}.md не упомянут в таблицах docs/guide/README.md`,
      );
    }
  }
}

/* ------------------------------------------------------------------ ссылки */

/**
 * Идентификатор заголовка: приставка главы плюс якорь.
 *
 * Главы лежат в одном файле, а «Запуск» и «Что дальше» встречаются в них
 * многократно: без приставки такие `id` столкнулись бы, и ссылка вела бы
 * в первую попавшуюся главу.
 */
function anchorId(slug, anchor) {
  return `${slug}${ANCHOR_SEP}${anchor}`;
}

/**
 * Переписывает ссылки главы в якоря одного документа.
 *
 * `./NN-имя.md#якорь` → `#NN-имя--якорь`, `./NN-имя.md` → `#NN-имя`,
 * `](#якорь)` внутри главы → `#NN-имя--якорь`. Ссылки в другие папки
 * `docs/` остаются как есть: `guide/` и `.site/` — соседние папки, и
 * относительный путь у них совпадает.
 *
 * @throws {BuildError} Ссылка на главу, которой нет среди разделов
 */
function rewriteLinks(text, slug, slugs) {
  // Сначала ссылки внутрь своей главы: иначе приставку получил бы и
  // результат переписывания ссылок на соседние главы
  const local = text.replace(
    /\]\(#([^)\s]+)\)/g,
    (all, anchor) => `](#${anchorId(slug, anchor)})`,
  );

  return local.replace(
    /\(\.\/([\w-]+)\.md(?:#([^)]*))?\)/g,
    (all, target, anchor) => {
      const chapter = target === 'README' ? INDEX_SLUG : target;

      if (chapter !== INDEX_SLUG && !slugs.has(chapter)) {
        throw new BuildError(
          `docs/guide/${slug}.md ссылается на './${target}.md', которого нет ` +
            `среди глав документа`,
        );
      }

      return `(#${anchor ? anchorId(chapter, anchor) : chapter})`;
    },
  );
}

/* ------------------------------------------------------------------ каркас */

/** Заголовки `##` главы: её подпункты в сайдбаре */
function sectionsOf(text, slug) {
  const sections = [];

  for (const line of text.split('\n')) {
    const m = /^##\s+(.+?)\s*(\{#([\w-]+)\})?\s*$/.exec(line);
    if (!m) {
      continue;
    }

    const label = m[1].replace(/`/g, '');
    sections.push({
      label,
      anchor: anchorId(slug, m[3] ?? slugifyAnchor(label)),
    });
  }

  return sections;
}

/**
 * Якорь заголовка по правилам `markdown-it-anchor`, которых здесь нет:
 * ссылки внутри документа строит сам генератор, поэтому правило одно и то
 * же для сайдбара и для разметки заголовка.
 */
function slugifyAnchor(label) {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Ставит `id` заголовкам `##` и приставляет главу к явным `{#id}` */
function anchorHeadings(html, sections, slug) {
  let index = 0;

  const explicit = html.replace(
    /(<h[1-6][^>]*\sid=")([^"]*)(")/g,
    (all, head, id, tail) => `${head}${escapeAttr(anchorId(slug, id))}${tail}`,
  );

  return explicit.replace(/<h2(\s[^>]*)?>/g, (all, attrs = '') => {
    const section = sections[index++];

    if (!section || /\bid=/.test(attrs)) {
      return all;
    }

    return `<h2${attrs} id="${escapeAttr(section.anchor)}">`;
  });
}

/**
 * Пункт главы в сайдбаре и список её разделов.
 *
 * Разделы лежат в разметке у каждой главы, а показываются у читаемой:
 * двадцать восемь глав сразу дали бы больше сотни подпунктов. Какую
 * главу читают, решает встроенный скрипт.
 */
function renderNavItem(chapter) {
  const slug = escapeAttr(chapter.slug);
  const link =
    `      <li><a href="#${slug}" data-chapter="${slug}">` +
    `${escapeHtml(chapter.title)}</a>`;

  if (chapter.sections.length === 0) {
    return `${link}</li>`;
  }

  const sub = chapter.sections
    .map(
      (section) =>
        `          <li><a href="#${escapeAttr(section.anchor)}">` +
        `${escapeHtml(section.label)}</a></li>`,
    )
    .join('\n');

  return (
    `${link}\n        <ul class="nav-sub" data-for="${slug}">\n` +
    `${sub}\n        </ul></li>`
  );
}

/** Один сайдбар на документ: все части и главы, ссылки якорями */
function renderSidebar(chapters) {
  const groups = [];

  for (const chapter of chapters) {
    const last = groups.at(-1);

    if (last && last.name === chapter.group) {
      last.chapters.push(chapter);
    } else {
      groups.push({ name: chapter.group, chapters: [chapter] });
    }
  }

  const rendered = groups.map(({ name, chapters: items }) => {
    const title = `  <p class="nav-title">${escapeHtml(name)}</p>`;
    const links = items.map(renderNavItem).join('\n');

    return `  <div class="nav-group">\n${title}\n    <ul>\n${links}\n    </ul>\n  </div>`;
  });

  return `<aside class="sidebar">\n${rendered.join('\n')}\n</aside>`;
}

/** Ссылки на соседние главы: они лежат ниже и выше в том же файле */
function renderPager({ prev, next }) {
  const link = (chapter, dir, cls) =>
    `    <a${cls ? ` class="${cls}"` : ''} href="#${escapeAttr(chapter.slug)}">\n` +
    `      <div class="dir">${escapeHtml(dir)}</div>\n` +
    `      <div class="ttl">${escapeHtml(chapter.title)}</div>\n` +
    `    </a>`;

  const parts = [prev ? link(prev, '← Назад', '') : '    <span></span>'];
  if (next) {
    parts.push(link(next, 'Далее →', 'next'));
  }

  return `  <nav class="pager">\n${parts.join('\n')}\n  </nav>\n`;
}

/* ------------------------------------------------------------------ сборка */

function build() {
  const layout = readFileSync(join(HERE, 'layout.html'), 'utf8');
  const styles = readFileSync(join(HERE, 'styles.css'), 'utf8');
  const script = readFileSync(join(HERE, 'app.js'), 'utf8');
  const readme = readFileSync(join(GUIDE, 'README.md'), 'utf8');

  const outline = readOutline(readme);
  assertComplete(outline);

  // Каталог собирается заново: файл прошлой сборки иначе остался бы лежать
  // в выводе и открываться по прежнему адресу
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const slugs = new Set(outline.map((chapter) => chapter.slug));

  // Документ открывает README гайда; в сайдбаре он — группа «Гайд»
  const chapters = [
    { slug: INDEX_SLUG, title: 'Гайд по Nestling', group: 'Гайд', source: readme },
    ...outline.map((chapter) => ({
      ...chapter,
      source: readFileSync(join(GUIDE, `${chapter.slug}.md`), 'utf8'),
    })),
  ].map((chapter) => ({
    ...chapter,
    sections: sectionsOf(chapter.source, chapter.slug),
  }));

  const body = chapters
    .map((chapter, index) => {
      const text = rewriteLinks(chapter.source, chapter.slug, slugs);
      const article = anchorHeadings(
        md.render(text),
        chapter.sections,
        chapter.slug,
      );
      const pager = renderPager({
        prev: chapters[index - 1],
        next: chapters[index + 1],
      });

      return (
        `<section class="chapter" id="${escapeAttr(chapter.slug)}">\n` +
        `${article}${pager}</section>`
      );
    })
    .join('\n');

  let html = fill(layout, '{{title}}', escapeHtml('Nestling — гайд'));
  html = fill(html, '{{styles}}', styles);
  html = fill(html, '{{sidebar}}', renderSidebar(chapters));
  html = fill(html, '{{chapters}}', body);
  html = fill(html, '{{script}}', script);

  writeFileSync(join(OUT, FILE), html);
  console.log(`  docs/.site/${FILE} — глав: ${chapters.length}`);
}

/** Ошибка гайда печатается строкой: стектрейс генератора читателю не нужен */
function buildOrExit() {
  try {
    build();
  } catch (error) {
    if (error instanceof BuildError) {
      console.error(`Сборка сайта не удалась: ${error.message}`);
      process.exit(1);
    }

    throw error;
  }
}

console.log('Сборка сайта:');
buildOrExit();

if (process.argv.includes('--watch')) {
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log('Изменения, пересобираю:');
      try {
        build();
      } catch (error) {
        console.error(error.message);
      }
    }, 50);
  };

  watch(GUIDE, { recursive: true }, rebuild);
  watch(HERE, { recursive: true }, rebuild);
  console.log('\nЖду изменений в docs/guide/ и scripts/site/ …  (Ctrl+C — выход)');
}
