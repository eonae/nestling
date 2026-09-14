#!/usr/bin/env node
/**
 * Проверка заметки о выпуске — скрипт скилла release-notes.
 *
 * Механические инварианты заметки: форма плашки, порядок разделов, список
 * в «Коротко», якорь у ссылки «Почему» и пометка «Обновление» у раздела с
 * парой блоков «было и стало».
 *
 * Запуск из корня репозитория:
 *   node .claude/skills/release-notes/scripts/check.mjs [--fix] [путь ...]
 *
 * Без путей проверяет все файлы `docs/releases/v*.md` и их пары в
 * `docs/en/releases/`. Оглавления папок проверяет `yarn docs:audit`.
 *
 * --fix — проставить якоря ссылкам «Почему»: заголовок записи скрипт
 * берёт из инлайн-кода строки, ищет его в целевом файле журнала и строит
 * якорь так же, как строит GitHub. Якорь пишется процентно закодированным
 * на обоих языках: кириллица лежит вне обратных кавычек, и там её ловят
 * два инварианта — `lang-cyrillic` в английском файле и запрещённые слова
 * `docs-style` в русском.
 *
 * Exit 1 — есть хотя бы один ERROR.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const RELEASES = join(ROOT, 'docs/releases');
const RELEASES_EN = join(ROOT, 'docs/en/releases');

/**
 * Разделы канона и их названия на обоих языках.
 *
 * Порядок массива — порядок разделов заметки. Разделы по подсистемам в
 * каноне не названы: их имена называет выпуск, и скрипт их пропускает.
 */
const CANON = [
  { key: 'upgrade', ru: 'Обновление', en: 'Upgrading', required: true },
  { key: 'brief', ru: 'Коротко', en: 'In brief', required: true },
  { key: 'silent', ru: 'Ломается молча', en: 'Breaks silently' },
  { key: 'removed', ru: 'Удалено', en: 'Removed' },
  { key: 'testing', ru: 'Тестирование', en: 'Testing' },
  { key: 'examples', ru: 'Примеры и документация', en: 'Examples and documentation' },
  { key: 'next', ru: 'Что дальше', en: 'What is next' },
  { key: 'repo', ru: 'Для тех, кто собирает репозиторий', en: 'For those who build the repository' },
  { key: 'renames', ru: 'Таблица переименований', en: 'Renames table', required: true },
];

/** Строка пометки «Почему» на обоих языках */
const WHY = /^>\s*(Почему|Why):\s*(.*)$/;

/** Строка пометки «Обновление» на обоих языках */
const UPGRADE_NOTE = /^>\s*(Обновление|Upgrade):/;

const findings = [];
const add = (level, invariant, file, message) =>
  findings.push({ level, invariant, file: relative(ROOT, file), message });

/**
 * Якорь заголовка так, как его строит GitHub.
 *
 * Регистр опускается, всё, кроме букв, цифр, пробелов, дефисов и
 * подчёркиваний, удаляется, пробелы заменяются дефисами. Пробелы не
 * схлопываются: `Метрика — декларация` даёт двойной дефис на месте тире.
 */
const slug = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

/** Заголовок без обратных кавычек и с одиночными пробелами */
const normalize = (text) => text.replace(/`/g, '').replace(/\s+/g, ' ').trim();

/** Строки файла вне блоков кода: `[номер, строка]` */
function proseLines(text) {
  const out = [];
  let inFence = false;

  text.split('\n').forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;

      return;
    }

    if (!inFence) {
      out.push([i + 1, raw]);
    }
  });

  return out;
}

/** Заголовки `##` и `###` файла журнала: якорь → заголовок */
function anchorsOf(file) {
  const map = new Map();

  for (const [, raw] of proseLines(readFileSync(file, 'utf8'))) {
    const m = raw.match(/^#{2,3}\s+(.+?)\s*$/);

    if (m) {
      map.set(slug(m[1]), normalize(m[1]));
    }
  }

  return map;
}

/** 1. Плашка называет диапазон двумя тегами */
function checkBanner(file, text) {
  const lines = text.split('\n');
  const banner = [];

  for (const raw of lines.slice(1)) {
    if (raw.startsWith('>')) {
      banner.push(raw);
    } else if (banner.length > 0) {
      break;
    }
  }

  if (banner.length === 0) {
    add('ERROR', 'banner', file, 'плашки после заголовка нет');

    return;
  }

  const joined = banner.join(' ');
  const tags = joined.match(/`v\d+\.\d+\.\d+`/g) ?? [];

  if (tags.length < 2) {
    add('ERROR', 'banner', file,
      `плашка называет ${tags.length} тег(а), а диапазон — это два`);
  }

  const sha = joined.match(/`[0-9a-f]{7,40}`/);

  if (sha) {
    add('ERROR', 'banner', file,
      `плашка называет SHA ${sha[0]}; обе границы диапазона — теги`);
  }
}

/** 2. Разделы канона идут в порядке канона, обязательные на месте */
function checkSections(file, text, lang) {
  const seen = [];

  for (const [line, raw] of proseLines(text)) {
    const m = raw.match(/^##\s+(.+?)(?:\s*\{#[\w-]+\})?\s*$/);

    if (!m) continue;

    const title = normalize(m[1]);
    const canon = CANON.find((s) => normalize(s[lang]) === title);

    if (canon) {
      seen.push({ ...canon, line });
    }
  }

  for (const required of CANON.filter((s) => s.required)) {
    if (!seen.some((s) => s.key === required.key)) {
      add('ERROR', 'sections', file,
        `раздела «${required[lang]}» нет, а он обязателен`);
    }
  }

  const order = CANON.map((s) => s.key);
  let previous = -1;

  for (const section of seen) {
    const index = order.indexOf(section.key);

    if (index < previous) {
      add('ERROR', 'sections', file,
        `строка ${section.line}: раздел «${section[lang]}» стоит позже, чем канон его ставит`);
    }

    previous = Math.max(previous, index);
  }
}

/** 3. «Коротко» — список, а не абзац */
function checkBrief(file, text, lang) {
  const brief = CANON.find((s) => s.key === 'brief')[lang];
  const lines = proseLines(text);
  const start = lines.findIndex(([, raw]) => normalize(raw) === `## ${brief}`);

  if (start === -1) return;

  for (const [line, raw] of lines.slice(start + 1)) {
    if (raw.trim() === '') continue;

    if (raw.startsWith('##')) break;

    if (!raw.startsWith('- ')) {
      add('ERROR', 'brief-list', file,
        `строка ${line}: «${brief}» начинается абзацем, а этот раздел — список`);
    }

    break;
  }
}

/** 4. Ссылка «Почему» несёт якорь, и якорь ведёт на запись */
function checkWhy(file, text, lang, fix) {
  const lines = text.split('\n');
  let changed = false;

  lines.forEach((raw, i) => {
    const why = raw.match(WHY);

    if (!why) return;

    const link = raw.match(/\]\((\.{1,2}\/[^)\s]+?)\)/);

    if (!link) {
      add('ERROR', 'why-link', file,
        `строка ${i + 1}: пометка «Почему» без ссылки на запись журнала`);

      return;
    }

    const [target, anchor] = link[1].split('#');
    const absolute = resolve(dirname(file), target);

    if (!existsSync(absolute)) {
      add('ERROR', 'why-link', file,
        `строка ${i + 1}: ссылка ведёт на ${target}, которого нет`);

      return;
    }

    const anchors = anchorsOf(absolute);
    const title = raw.match(/`([^`]+)`/);

    if (!title) {
      add('ERROR', 'why-link', file,
        `строка ${i + 1}: заголовок записи не назван инлайн-кодом`);

      return;
    }

    const wanted = normalize(title[1]);
    const matches = [...anchors].filter(([, heading]) => heading.startsWith(wanted));

    if (matches.length === 0) {
      add('ERROR', 'why-link', file,
        `строка ${i + 1}: записи «${wanted}» в ${target} нет`);

      return;
    }

    if (matches.length > 1) {
      add('ERROR', 'why-link', file,
        `строка ${i + 1}: «${wanted}» начинает ${matches.length} записей; назовите заголовок целиком`);

      return;
    }

    const expected = encodeURIComponent(matches[0][0]);

    if (anchor === expected) return;

    if (fix) {
      lines[i] = raw.replace(link[1], `${target}#${expected}`);
      changed = true;

      return;
    }

    add('ERROR', 'why-anchor', file,
      anchor
        ? `строка ${i + 1}: якорь не совпадает с записью, чинится --fix`
        : `строка ${i + 1}: ссылка ведёт на файл целиком, якоря нет, чинится --fix`);
  });

  if (changed) {
    writeFileSync(file, lines.join('\n'));
  }
}

/** 5. Ссылка внутрь заметки ведёт на её заголовок */
function checkLocalAnchors(file, text) {
  const own = new Set();

  for (const [, raw] of proseLines(text)) {
    const m = raw.match(/^#{2,3}\s+(.+?)(?:\s*\{#([\w-]+)\})?\s*$/);

    if (m) {
      own.add(m[2] ?? slug(m[1]));
    }
  }

  for (const [line, raw] of proseLines(text)) {
    for (const m of raw.matchAll(/\]\(#([^)\s]+)\)/g)) {
      if (!own.has(decodeURIComponent(m[1]))) {
        add('ERROR', 'local-anchor', file,
          `строка ${line}: ссылка «#${m[1]}» не ведёт ни на один заголовок заметки`);
      }
    }
  }
}

/** 6. Раздел с парой блоков «было и стало» несёт пометку «Обновление» */
function checkUpgradeNotes(file, text, lang) {
  const blocks = text.split(/^(#{2,3}\s+.+)$/m);

  for (let i = 1; i < blocks.length; i += 2) {
    const heading = normalize(blocks[i].replace(/^#+\s+/, ''));
    const body = blocks[i + 1] ?? '';

    if (CANON.some((s) => normalize(s[lang]) === heading)) continue;

    const versions = body.match(/^\/\/.*—\s*\d+\.\d+\.\d+\s*$/gm) ?? [];

    if (versions.length < 2) continue;

    if (!body.split('\n').some((raw) => UPGRADE_NOTE.test(raw))) {
      add('WARN', 'upgrade-note', file,
        `раздел «${heading}» показывает две версии, а пометки «Обновление» не несёт`);
    }
  }
}

function checkFile(file, fix) {
  const text = readFileSync(file, 'utf8');
  const lang = file.includes('/docs/en/') ? 'en' : 'ru';

  checkBanner(file, text);
  checkSections(file, text, lang);
  checkBrief(file, text, lang);
  checkWhy(file, text, lang, fix);
  checkLocalAnchors(file, readFileSync(file, 'utf8'));
  checkUpgradeNotes(file, text, lang);
}

const args = process.argv.slice(2);
const fix = args.includes('--fix');
const paths = args.filter((a) => !a.startsWith('--'));

const notes =
  paths.length > 0
    ? paths.map((p) => resolve(ROOT, p))
    : [RELEASES, RELEASES_EN].flatMap((dir) =>
        existsSync(dir)
          ? readdirSync(dir)
              .filter((f) => /^v\d+\.\d+\.\d+\.md$/.test(f))
              .map((f) => join(dir, f))
          : [],
      );

for (const note of notes) {
  if (!existsSync(note)) {
    add('ERROR', 'path', note, 'файла нет');

    continue;
  }

  checkFile(note, fix);
}

const errors = findings.filter((f) => f.level === 'ERROR');

for (const f of findings) {
  console.log(`${f.level} ${f.invariant} ${f.file}: ${f.message}`);
}

console.log(
  `\nПроверено заметок: ${notes.length}. ERROR: ${errors.length}, WARN: ${findings.length - errors.length}.`,
);

process.exit(errors.length > 0 ? 1 : 0);
