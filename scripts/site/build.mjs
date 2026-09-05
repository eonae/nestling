#!/usr/bin/env node
/**
 * Сборка сайта документации: главы гайда (`docs/guide/*.md`) → статический HTML.
 *
 * Источник текста один — гайд. Состав и порядок страниц берутся из
 * `docs/guide/README.md`: заголовки `## Часть N. …` и `## Приложения`
 * дают группы сайдбара, строки таблиц под ними — страницы. Каркас
 * страницы и тема лежат рядом со скриптом, в `scripts/site/`; HTML в
 * `docs/.site/` — результат сборки, git его не отслеживает.
 *
 *   yarn docs:build   — собрать один раз
 *   yarn docs:dev     — пересобирать при изменении docs/guide/ и scripts/site/
 */

import {
  copyFileSync,
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

/** Каталог скрипта: рядом лежат каркас страницы и тема */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'docs', '.site');
const GUIDE = join(ROOT, 'docs', 'guide');

/** Файлы темы: браузер берёт их рядом со страницей, поэтому сборка их копирует */
const THEME = ['styles.css', 'app.js'];

/** Стартовая страница: README гайда */
const INDEX_SLUG = 'index';

/** Алиасы языков: то, что пишем в ```-заборе → значение data-lang. */
const LANG_ALIAS = { ts: 'typescript', js: 'javascript' };

/* ------------------------------------------------------------------ утилиты */

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

/** Ошибка сборки: текст уже объясняет, что править в гайде */
class BuildError extends Error {}

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
 * Главы гайда начинают сниппет строкой `// packages/…/file.ts`; она же
 * говорит читателю, какой файл примера открыть. Строка остаётся в коде:
 * скопированный сниппет не теряет адрес.
 */
function fileOf(code) {
  const [first] = code.split('\n');
  const m = /^\s*\/\/\s*([\w./@-]+\.[a-z]+)\s*$/.exec(first ?? '');

  return m ? m[1] : '';
}

/**
 * ```ts            → <div class="code" data-lang="typescript">
 * Подпись `data-file` берётся из первой строки-комментария сниппета.
 * Подсветку делает app.js в браузере, здесь только разметка.
 */
md.renderer.rules.fence = (tokens, idx) => {
  const info = tokens[idx].info.trim();
  const alias = info.split(/\s/)[0];
  const lang = LANG_ALIAS[alias] ?? alias;
  const code = tokens[idx].content.replace(/\n$/, '');
  const file = fileOf(code);
  const fileAttr = file ? ` data-file="${escapeAttr(file)}"` : '';
  const langAttr = lang ? ` data-lang="${escapeAttr(lang)}"` : '';

  return `<div class="code"${fileAttr}${langAttr}><pre><code>${escapeHtml(code)}</code></pre></div>\n`;
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
 * Читает состав сайта из README гайда.
 *
 * Группа — заголовок `## Часть N. …` или `## Приложения`; страницы группы
 * — строки таблицы под ним: первая ячейка несёт ссылку на главу и её
 * заголовок.
 *
 * @returns Страницы в порядке README: `{ slug, title, group }`
 */
function readOutline(readme) {
  const pages = [];
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

    pages.push({ slug: cell[2], title: cell[1], group });
  }

  if (pages.length === 0) {
    throw new BuildError(
      'docs/guide/README.md: в таблицах нет ни одной ссылки на главу',
    );
  }

  return pages;
}

/**
 * Сверяет состав README с файлами `docs/guide`.
 *
 * Расхождение в любую сторону — ошибка сборки: страница без главы
 * собралась бы пустой, а глава без строки README не попала бы в
 * навигацию и осталась бы недоступной.
 */
function assertComplete(pages) {
  const listed = new Set(pages.map((page) => page.slug));

  const files = readdirSync(GUIDE)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => name.replace(/\.md$/, ''));

  for (const { slug } of pages) {
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
 * Переписывает ссылки между главами в ссылки между страницами.
 *
 * `./NN-имя.md#якорь` → `NN-имя.html#якорь`. Ссылки в другие папки
 * `docs/` остаются как есть: `guide/` и `.site/` — соседние папки, и
 * относительный путь у них совпадает.
 *
 * @throws {BuildError} Ссылка на главу, которой нет среди страниц
 */
function rewriteLinks(text, slug, slugs) {
  return text.replace(
    /\(\.\/([\w-]+)\.md(#[^)]*)?\)/g,
    (all, target, anchor = '') => {
      if (target === 'README') {
        return `(${INDEX_SLUG}.html${anchor})`;
      }

      if (!slugs.has(target)) {
        throw new BuildError(
          `docs/guide/${slug}.md ссылается на './${target}.md', которого нет ` +
            `среди страниц сайта`,
        );
      }

      return `(${target}.html${anchor})`;
    },
  );
}

/* ------------------------------------------------------------------ каркас */

/** Заголовки `##` открытой страницы: подпункты её группы в сайдбаре */
function sectionsOf(text) {
  const sections = [];

  for (const line of text.split('\n')) {
    const m = /^##\s+(.+?)\s*(\{#([\w-]+)\})?\s*$/.exec(line);
    if (!m) {
      continue;
    }

    const label = m[1].replace(/`/g, '');
    sections.push({ label, anchor: m[3] ?? slugifyAnchor(label) });
  }

  return sections;
}

/**
 * Якорь заголовка по правилам `markdown-it-anchor`, которых здесь нет:
 * ссылки внутри страницы строит сам генератор, поэтому правило одно и то
 * же для сайдбара и для разметки заголовка.
 */
function slugifyAnchor(label) {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Ставит `id` заголовкам `##`, чтобы подпункты сайдбара вели внутрь страницы */
function anchorHeadings(html, sections) {
  let index = 0;

  return html.replace(/<h2(\s[^>]*)?>/g, (all, attrs = '') => {
    const section = sections[index++];

    if (!section || /\bid=/.test(attrs)) {
      return all;
    }

    return `<h2${attrs} id="${escapeAttr(section.anchor)}">`;
  });
}

function renderSidebar(current, pages) {
  const groups = [];

  for (const page of pages) {
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
      .map((page) => {
        const active = page.slug === current.slug ? ' class="active"' : '';
        return (
          `      <li><a href="${escapeAttr(page.slug)}.html"${active}>` +
          `${escapeHtml(page.title)}</a></li>`
        );
      })
      .join('\n');

    const open = items.some((page) => page.slug === current.slug);
    if (!open) {
      return `  <div class="nav-group">\n${title}\n    <ul>\n${links}\n    </ul>\n  </div>`;
    }

    const sub = current.sections
      .map(
        (section) =>
          `      <li><a href="#${escapeAttr(section.anchor)}">${escapeHtml(section.label)}</a></li>`,
      )
      .join('\n');

    const subList = sub
      ? `\n    <ul class="nav-sub">\n${sub}\n    </ul>`
      : '';

    return `  <div class="nav-group">\n${title}\n    <ul>\n${links}\n    </ul>${subList}\n  </div>`;
  });

  return `<aside class="sidebar">\n${rendered.join('\n')}\n</aside>`;
}

function renderPager({ prev, next }) {
  const link = (page, dir, cls) =>
    `    <a${cls ? ` class="${cls}"` : ''} href="${escapeAttr(page.slug)}.html">\n` +
    `      <div class="dir">${escapeHtml(dir)}</div>\n` +
    `      <div class="ttl">${escapeHtml(page.title)}</div>\n` +
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
  const readme = readFileSync(join(GUIDE, 'README.md'), 'utf8');

  const outline = readOutline(readme);
  assertComplete(outline);

  // Каталог собирается заново: страница удалённой главы иначе осталась бы
  // лежать в выводе и открываться по прежнему адресу
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const slugs = new Set(outline.map((page) => page.slug));

  // Стартовая страница — сам README; в сайдбаре она не пункт, а группа
  // «Гайд по Nestling» со ссылкой на себя
  const pages = [
    { slug: INDEX_SLUG, title: 'Гайд по Nestling', group: 'Гайд', source: readme },
    ...outline.map((page) => ({
      ...page,
      source: readFileSync(join(GUIDE, `${page.slug}.md`), 'utf8'),
    })),
  ];

  for (const [index, page] of pages.entries()) {
    const sections = sectionsOf(page.source);
    const text = rewriteLinks(page.source, page.slug, slugs);
    const article = anchorHeadings(md.render(text), sections);

    const html = layout
      .replace('{{title}}', escapeHtml(`Nestling — ${page.title}`))
      .replace('{{sidebar}}', renderSidebar({ ...page, sections }, pages))
      .replace('{{article}}', article)
      .replace(
        '{{pager}}',
        renderPager({ prev: pages[index - 1], next: pages[index + 1] }),
      );

    writeFileSync(join(OUT, `${page.slug}.html`), html);
    console.log(`  docs/.site/${page.slug}.html`);
  }

  // Тема лежит рядом с генератором, а браузер ищет её рядом со страницей
  for (const file of THEME) {
    copyFileSync(join(HERE, file), join(OUT, file));
  }
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
