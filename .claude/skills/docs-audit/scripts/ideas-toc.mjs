#!/usr/bin/env node
/**
 * Оглавление docs/decisions/ideas.md: дата, заголовок и статус каждой записи.
 * Блок стоит в шапке файла между маркерами <!-- ideas-toc:start --> и
 * <!-- ideas-toc:end -->; статус даёт пометка «РЕАЛИЗОВАНО» или «СУПЕРСИД»
 * в любом месте записи — цитатой под заголовком или разделом в конце.
 *
 * Запуск из корня репозитория:
 *   node .claude/skills/docs-audit/scripts/ideas-toc.mjs           перезаписать блок
 *   node .claude/skills/docs-audit/scripts/ideas-toc.mjs --check   код 1, если блок устарел
 *
 * Правило 14 «Правил ведения» из docs/README.md; проверку делает check.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const START = '<!-- ideas-toc:start -->';
export const END = '<!-- ideas-toc:end -->';
export const IDEAS = 'docs/decisions/ideas.md';

export function buildIdeasToc(text) {
  const lines = text.split('\n');
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^## \[(\d{4}-\d{2}-\d{2})\] (.+)$/.exec(lines[i]);
    if (!m) continue;
    let status = '';
    for (let j = i + 1; j < lines.length && !/^## \[\d{4}-\d{2}-\d{2}\]/.test(lines[j]); j++) {
      const l = lines[j];
      if (!l.startsWith('>') && !l.startsWith('###')) continue;
      if (/СУПЕРСИД|superseded/i.test(l)) status = 'заменено';
      else if (/РЕАЛИЗОВАНО/.test(l)) status = 'реализовано';
      if (status) break;
    }
    items.push(`- ${m[1]} · ${m[2]}${status ? ` · ${status}` : ''}`);
  }
  return [
    START,
    `Записей: ${items.length}. Блок генерируется скриптом, руками не правится.`,
    '',
    ...items,
    END,
  ].join('\n');
}

export function applyToc(text) {
  const block = buildIdeasToc(text);
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  if (s >= 0 && e > s) return text.slice(0, s) + block + text.slice(e + END.length);
  const sep = text.indexOf('\n---\n');
  if (sep < 0) throw new Error(`${IDEAS}: нет разделителя --- после шапки`);
  return `${text.slice(0, sep + 5)}\n${block}\n${text.slice(sep + 5)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = readFileSync(IDEAS, 'utf8');
  const next = applyToc(text);
  if (process.argv.includes('--check')) process.exit(next === text ? 0 : 1);
  if (next === text) console.log('оглавление ideas.md актуально');
  else {
    writeFileSync(IDEAS, next);
    console.log('оглавление ideas.md обновлено');
  }
}
