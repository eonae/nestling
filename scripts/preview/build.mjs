#!/usr/bin/env node
/**
 * Сборка docs/preview: Markdown (`docs/preview/src/*.md`) → статический HTML.
 *
 * Каркас страницы (шапка, сайдбар, пейджер) живёт в `src/layout.html` и `src/nav.mjs`
 * в единственном экземпляре; в .md лежит только контент. HTML в docs/preview/ —
 * результат сборки, руками не правится.
 *
 *   yarn docs:preview           — собрать один раз
 *   yarn docs:preview --watch   — пересобирать при изменении src/
 */

import { readFileSync, watch, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import MarkdownIt from 'markdown-it';
import attrs from 'markdown-it-attrs';
import container from 'markdown-it-container';

import { OVERVIEW_LABEL, PAGES } from '../../docs/preview/src/nav.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PREVIEW = join(ROOT, 'docs', 'preview');
const SRC = join(PREVIEW, 'src');

/** Алиасы языков: то, что пишем в ```-заборе → значение data-lang. */
const LANG_ALIAS = { ts: 'typescript', js: 'javascript' };

/* ------------------------------------------------------------------ утилиты */

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

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
      throw new Error('У :::note обязателен заголовок: `:::note Заголовок`');
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
      throw new Error(
        `:::card ждёт «иконку и заголовок», получено: ${rest || '(пусто)'}`,
      );
    return `<div class="card"><span class="ic">${m[1]}</span><h3>${md.renderInline(m[2])}</h3>`;
  },
});

/**
 * ```ts main.ts   → <div class="code" data-file="main.ts" data-lang="typescript">
 * ```ts           → <div class="code" data-lang="typescript">
 * Подсветку делает app.js в браузере, здесь только разметка.
 */
md.renderer.rules.fence = (tokens, idx) => {
  const info = tokens[idx].info.trim();
  const sp = info.search(/\s/);
  const alias = sp === -1 ? info : info.slice(0, sp);
  const file = sp === -1 ? '' : info.slice(sp).trim();
  const lang = LANG_ALIAS[alias] ?? alias;
  if (!lang) throw new Error('У ```-блока не указан язык');
  const fileAttr = file ? ` data-file="${escapeAttr(file)}"` : '';
  const body = escapeHtml(tokens[idx].content.replace(/\n$/, ''));
  return `<div class="code"${fileAttr} data-lang="${escapeAttr(lang)}"><pre><code>${body}</code></pre></div>\n`;
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

/* ------------------------------------------------------------------ каркас */

function renderSidebar(current) {
  const groups = PAGES.map((page) => {
    const title = `  <p class="nav-title">${escapeHtml(page.group)}</p>`;
    if (page.slug !== current.slug) {
      const items = page.collapsed
        .map(
          (i) =>
            `      <li><a href="${escapeAttr(i.href)}">${escapeHtml(i.label)}</a></li>`,
        )
        .join('\n');
      return `  <div class="nav-group">\n${title}\n    <ul>\n${items}\n    </ul>\n  </div>`;
    }
    const active = `      <li><a href="${page.slug}.html" class="active">${escapeHtml(OVERVIEW_LABEL)}</a></li>`;
    const sub = page.sub
      .map(
        (i) =>
          `      <li><a href="#${escapeAttr(i.anchor)}">${escapeHtml(i.label)}</a></li>`,
      )
      .join('\n');
    return `  <div class="nav-group">\n${title}\n    <ul>\n${active}\n    </ul>\n    <ul class="nav-sub">\n${sub}\n    </ul>\n  </div>`;
  });
  return `<aside class="sidebar">\n${groups.join('\n')}\n</aside>`;
}

function renderPager({ prev, next } = {}) {
  const link = (l, cls) =>
    `    <a${cls ? ` class="${cls}"` : ''} href="${escapeAttr(l.href)}">\n` +
    `      <div class="dir">${escapeHtml(l.dir)}</div>\n` +
    `      <div class="ttl">${escapeHtml(l.title)}</div>\n` +
    `    </a>`;
  const parts = [prev ? link(prev, '') : '    <span></span>'];
  if (next) parts.push(link(next, 'next'));
  return `  <nav class="pager">\n${parts.join('\n')}\n  </nav>\n`;
}

/* ------------------------------------------------------------------ сборка */

function build() {
  const layout = readFileSync(join(SRC, 'layout.html'), 'utf8');
  for (const page of PAGES) {
    const source = readFileSync(join(SRC, `${page.slug}.md`), 'utf8');
    const html = layout
      .replace('{{title}}', escapeHtml(page.title))
      .replace('{{sidebar}}', renderSidebar(page))
      .replace('{{article}}', md.render(source))
      .replace('{{pager}}', renderPager(page.pager));
    writeFileSync(join(PREVIEW, `${page.slug}.html`), html);
    console.log(`  docs/preview/${page.slug}.html`);
  }
}

console.log('Сборка превью:');
build();

if (process.argv.includes('--watch')) {
  let timer = null;
  watch(SRC, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log('Изменения в src/, пересобираю:');
      try {
        build();
      } catch (e) {
        console.error(e.message);
      }
    }, 50);
  });
  console.log('\nЖду изменений в docs/preview/src/ …  (Ctrl+C — выход)');
}
