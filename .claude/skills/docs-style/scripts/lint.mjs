#!/usr/bin/env node
/**
 * Проверка текстов на жаргон — скрипт скилла docs-style.
 *
 * Ищет запрещённые слова (список ниже) в Markdown-файлах, в комментариях
 * TypeScript-файлов и в заголовках тестов (`describe`/`it`/`test`). Код и
 * содержимое code-блоков не проверяет.
 *
 * Запуск из корня репозитория:
 *   node .claude/skills/docs-style/scripts/lint.mjs [--warn] [--json] [путь ...]
 *
 * Без путей проверяет docs/design, docs/guides, docs/glossary.md,
 * docs/README.md, README пакетов и src/ всех пакетов. docs/history и
 * docs/decisions не проверяются никогда: первая папка заморожена, вторая —
 * append-only.
 *
 * --warn — дополнительно показывать предупреждения (стрелки и цепочки тире
 * в прозе). Exit 1 — есть хотя бы одно запрещённое слово.
 *
 * Фрагмент Markdown между `<!-- docs-style: off -->` и
 * `<!-- docs-style: on -->` не проверяется (для таблиц вида «не пишем»).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();

// Запрещённые слова: регулярное выражение → чем заменить.
// Границы слова заданы вручную: `\b` не работает с кириллицей.
const B = '(?<![а-яёa-z])';
const E = '(?![а-яёa-z])';
const word = (stem) => new RegExp(`${B}${stem}${E}`, 'iu');

export const BANNED = [
  [word('провод(а|у|ом|е|ы|ов)?'), 'сеть, сериализация, «по сети», «в JSON»'],
  [word('репетици[яию]'), 'опишите поведение прямо: «ведёт себя как сетевая шина»'],
  [word('(в|во) эфир[е]?'), '«начинает принимать запросы», «слушает сокет»'],
  [word('go-live'), '«старт приёма запросов», фаза START'],
  [word('гас(ит|ят|ить|ила?|или)'), '«получает зависимости из контейнера», «резолвит»'],
  [word('гашени[еяю]'), '«получение зависимостей», «резолв»'],
  [word('(при|до|у|въ|подъ|съ)е(зжа|ха|де)(ет|ют|л|ла|ли|ть|т)'), '«передаётся», «регистрируется», «попадает», «приходит»'],
  [word('рожда(ет|ют)ся'), '«создаётся»'],
  [word('рождени[еяю]'), '«создание»'],
  [word('страж(а|у|ем|е|и|ей)?'), '«проверка» (назовите, что именно проверяется)'],
  [word('тракт(а|у|ом|е)?'), '«ответная фаза», «список юнитов `.ok`/`.catch`»'],
  [word('лакмус(а|ом|е)?'), '«проверка», «критерий»'],
  [word('LCD'), '«минимальный общий интерфейс»'],
  [word('примордиальн(ый|ая|ое|ые|ого|ой|ым|ом)'), '«первичный», «до сборки контейнера»'],
  [word('ре-?гидр(ирует|ируют|ация|ировать)'), '«восстанавливает `Fail` из ответа»'],
  [word('рематериализ(ация|ует|уют|овать)'), '«восстановление `Fail` из ответа»'],
  [word('несущ(ий|ая|ее|ие|его|ей|им|ем)'), '«обязательный», «на нём держится …»'],
  [word('сантехник[аиуе]'), '«байтовый уровень», «работа с байтами» (сжатие, CORS, парсинг)'],
  [word('материализ(ует|уют|ация|ованный|ованная|ованное|ованные|овать|уется|уются)'), '«создаётся при сборке», «превращается в узел графа»'],
  [word('негде'), '«не нужно», «нет места, где …» (перефразируйте)'],
  [word('вправе'), '«может», «разрешено»'],
  [word('внятн(ая|ый|ое|ые|ой|ую|ым)'), '«с понятным сообщением», «понятная»'],
  [word('разъе(хаться|дутся|халась|хались|хался)'), '«разойтись», «разнести по процессам», «перестать совпадать»'],
  [word('дихотоми[яию]'), 'уберите спор: опишите, как устроено'],
  [word('онтологи[яию]'), '«модель», «набор понятий»'],
  [word('капабилит[иь]'), '«право», «возможность»'],
  [word('топосорт(а|у|ом|е)?'), '«топологический порядок»'],
  [word('фейл-?фаст'), '«fail-fast» латиницей или «падает на старте»'],
  [word('ручк(а|и|у|ой|е|ам|ами|ах)'), '«endpoint»'],
  [word('эндпоинт(а|у|ом|е|ы|ов|ам|ами|ах)?'), '«endpoint» латиницей'],
  [word('дискавери'), '«discovery» латиницей'],
  [word('нейтральн(ый|ая|ое|ые) к транспорту'), '«не зависит от транспорта»'],
  [word('по применимости'), '«если ответ подходит юниту» (перефразируйте)'],
  [word('легальн(о|ый|ая|ое|ые|ого|ой|ым|ом)'), '«разрешено», «допустимо»'],
  [word('бесплатно'), '«без дополнительного кода», «автоматически»'],
  [word('дёшев(о|ый|ая|ое|ые)|дешев(о|ый|ая|ое|ые)'), 'скажите, что именно это стоит (или ничего не стоит)'],
  [word('сахар(а|ом|е)?'), '«сокращённая запись», «то же, что …»'],
  [word('машинери[яию]'), '«механизм», «код»'],
  [word('мешок(а|у|ом|е)?|мешк(а|у|ом|е)'), '«набор», «список», «объект»'],
  [word('луковиц[аыуе]'), '«вложенные обёртки», «модель middleware с `next()`»'],
  [word('(env-)?пол(а|у|ом)?'), '«process.env с низшим приоритетом», «источник по умолчанию»'],
];

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'history', 'decisions', 'coverage']);

const DEFAULT_TARGETS = [
  'docs/design',
  'docs/guides',
  'docs/glossary.md',
  'docs/README.md',
  'scripts/site',
  'README.ru.md',
  ...readdirSync(join(ROOT, 'packages'))
    .flatMap((p) => ['README.md', 'README.ru.md', 'src'].map((f) => join('packages', p, f))),
];

const args = process.argv.slice(2);
const showWarn = args.includes('--warn');
const asJson = args.includes('--json');
const targets = args.filter((a) => !a.startsWith('--'));

function walk(path, out) {
  let st;
  try {
    st = statSync(path);
  } catch {
    return out;
  }
  if (st.isDirectory()) {
    for (const f of readdirSync(path)) {
      if (IGNORED_DIRS.has(f)) continue;
      walk(join(path, f), out);
    }
  } else if (/\.(md|ts)$/.test(path) && !/\.d\.ts$/.test(path)) {
    out.push(path);
  }
  return out;
}

/**
 * Строки Markdown вне code-блоков и без инлайн-кода (иначе `null`).
 * Блок между `<!-- docs-style: off -->` и `<!-- docs-style: on -->` не
 * проверяется — так глоссарий перечисляет слова, которые мы не пишем.
 */
function proseLinesMd(text) {
  let inFence = false;
  let off = false;
  return text.split('\n').map((line) => {
    if (/<!--\s*docs-style:\s*off\s*-->/.test(line)) off = true;
    if (/<!--\s*docs-style:\s*on\s*-->/.test(line)) off = false;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return null;
    }
    if (inFence || off) return null;
    // Цитаты заголовков журнала «…» [YYYY-MM-DD] в плашках не правятся:
    // ideas.md append-only, его заголовки — часть ссылки.
    return line.replace(/`[^`]*`/g, '').replace(/«[^»]*»\s*\[\d{4}-\d{2}-\d{2}\]/g, '');
  });
}

/**
 * Строки комментариев TypeScript и заголовки тестов
 * (`describe`/`it`/`test`); остальное — `null`.
 */
const TEST_TITLE = /^\s*(describe|it|test)(\.(each|skip|only|todo|concurrent))*\s*\(\s*['"`]/;

function commentLinesTs(text) {
  let inBlock = false;
  return text.split('\n').map((line) => {
    if (TEST_TITLE.test(line)) return line;
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      return line.replace(/`[^`]*`/g, '');
    }
    const block = line.indexOf('/*');
    const inline = line.indexOf('//');
    if (block !== -1 && (inline === -1 || block < inline)) {
      if (!line.includes('*/', block)) inBlock = true;
      return line.slice(block).replace(/`[^`]*`/g, '');
    }
    if (inline !== -1) {
      return line.slice(inline).replace(/`[^`]*`/g, '');
    }
    return null;
  });
}

const findings = [];
const files = (targets.length ? targets : DEFAULT_TARGETS)
  .map((t) => resolve(ROOT, t))
  .flatMap((t) => walk(t, []));

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = file.endsWith('.md') ? proseLinesMd(text) : commentLinesTs(text);
  lines.forEach((line, i) => {
    if (line === null) return;
    for (const [re, hint] of BANNED) {
      const m = line.match(re);
      if (m) {
        findings.push({ severity: 'ERROR', file: relative(ROOT, file), line: i + 1, word: m[0], hint });
      }
    }
    if (!showWarn) return;
    if (/→/.test(line) && !/^\s*\|/.test(line)) {
      findings.push({ severity: 'WARN', file: relative(ROOT, file), line: i + 1, word: '→', hint: 'стрелка в прозе — напишите словами' });
    }
    const dashes = (line.match(/ — /g) ?? []).length;
    if (dashes >= 2) {
      findings.push({ severity: 'WARN', file: relative(ROOT, file), line: i + 1, word: '— … —', hint: 'два тире в одной строке — разбейте на предложения' });
    }
  });
}

if (asJson) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`\n${file} (${list.length})`);
    for (const f of list) {
      console.log(`  ${f.severity} :${f.line}  «${f.word}» → ${f.hint}`);
    }
  }
  const errors = findings.filter((f) => f.severity === 'ERROR').length;
  console.log(`\nФайлов проверено: ${files.length}; запрещённых слов: ${errors}; предупреждений: ${findings.length - errors}`);
}

process.exitCode = findings.some((f) => f.severity === 'ERROR') ? 1 : 0;
