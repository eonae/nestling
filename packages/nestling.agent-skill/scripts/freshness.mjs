/* eslint-disable no-console */
/* eslint-disable unicorn/no-process-exit */

/**
 * Поиск удалённых имён в тексте скилла.
 *
 * Скилл едет в проект копией и сам себя не обновляет, поэтому его текст
 * устаревает молча: компилятор видит сниппеты, а прозу и таблицы — никто.
 * Список удалённых имён строится по разделам «Таблица переименований»
 * заметок о выпуске: левая ячейка строки даёт имя, правая — замену.
 *
 * Прогон: `node scripts/freshness.mjs`. Проверку вызывает и
 * `src/freshness.spec.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SKILL_DIR } from './snippets.mjs';

/** Каталог заметок о выпусках: источник таблиц переименований */
export const RELEASES_DIR = fileURLToPath(
  new URL('../../../docs/releases/', import.meta.url),
);

/** Заголовок раздела, таблицу которого читает проверка */
const SECTION = 'Таблица переименований';

/**
 * Имена, которые проверка не ищет, и причина на каждое.
 *
 * Исключение чинит ложное срабатывание, и оно видно тому, кто читает
 * проверку: список короткий и каждая строка объясняет себя.
 */
const EXCEPTIONS = [
  [
    'inbox',
    'существительное освободилось под имя пакета @nestlingjs/inbox и под ' +
      'экземпляр плагина: удалена только фабрика inbox()',
  ],
  [
    'outbox',
    'существительное освободилось под имя пакета @nestlingjs/outbox и под ' +
      'экземпляр плагина: удалена только фабрика outbox()',
  ],
  [
    'openapi',
    'существительное освободилось под имя пакета @nestlingjs/openapi и под ' +
      'экземпляр плагина: удалена только фабрика openapi()',
  ],
  [
    'subscriptions',
    'существительное освободилось под имя пакета @nestlingjs/subscriptions ' +
      'и под экземпляр плагина: удалена только фабрика subscriptions()',
  ],
];

/** Имя целым словом: `$` в конце имени границей слова не считается */
const wordly = (name) =>
  new RegExp(
    `(?<![\\w$])${name.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`)}(?![\\w$])`,
  );

/**
 * Ищет удалённые имена в файлах скилла.
 *
 * @returns Находки и граница проверки: пропущенные ячейки и исключения
 */
export function checkRemovedNames() {
  const { names, skipped } = removedNames();
  const findings = [];

  for (const markdown of listMarkdown(SKILL_DIR)) {
    const lines = readFileSync(join(SKILL_DIR, markdown), 'utf8').split('\n');

    for (const [index, line] of lines.entries()) {
      for (const { name, row, release } of names) {
        if (wordly(name).test(line)) {
          findings.push({
            file: markdown,
            line: index + 1,
            message: `удалённое имя ${name}; ${release}: ${row}`,
          });
        }
      }
    }
  }

  return { findings, skipped, exceptions: EXCEPTIONS };
}

/**
 * Собирает удалённые имена по таблицам переименований всех заметок.
 *
 * @returns Имена с их строкой таблицы и ячейки, которые именем не сочтены
 */
export function removedNames() {
  const names = [];
  const skipped = [];
  const excluded = new Set(EXCEPTIONS.map(([name]) => name));

  for (const release of listMarkdown(RELEASES_DIR)) {
    const rows = renameRows(readFileSync(join(RELEASES_DIR, release), 'utf8'));
    const replacements = rows.map(({ to }) => to).join(' ');

    for (const { from, to, row } of rows) {
      const spans = codeSpans(from);

      if (spans.length === 0) {
        continue;
      }

      if (!listsNames(from)) {
        skipped.push({
          release,
          cell: from,
          reason: 'ячейка описывает поведение, а не перечисляет имена',
        });
        continue;
      }

      for (const cell of spans) {
        const name = identifierOf(cell);

        if (name === null) {
          skipped.push({ release, cell, reason: 'ячейка не имя и не вызов' });
          continue;
        }

        if (excluded.has(name)) {
          continue;
        }

        // Переименование могло сохранить корень имени: `int(fallback, min)`
        // стал `int().min(…)`, и само имя `int` живо
        if (wordly(name).test(replacements)) {
          skipped.push({
            release,
            cell,
            reason: `имя ${name} стоит в колонке замен той же таблицы`,
          });
          continue;
        }

        names.push({ name, row, release, to });
      }
    }
  }

  return { names, skipped };
}

/**
 * Строки таблиц из разделов «Таблица переименований».
 *
 * @param text - Содержимое заметки о выпуске
 */
function renameRows(text) {
  const rows = [];
  let inside = false;

  for (const line of text.split('\n')) {
    if (line.startsWith('#')) {
      inside = line.includes(SECTION);
      continue;
    }

    if (!inside || !line.startsWith('|')) {
      continue;
    }

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());

    // Шапка таблицы и разделитель под ней строками не считаются
    if (
      cells.length < 2 ||
      cells[0].startsWith('---') ||
      cells[0] === '0.2.0'
    ) {
      continue;
    }

    rows.push({ from: cells[0], to: cells[1], row: line.trim() });
  }

  return rows;
}

/** Содержимое всех парных обратных кавычек ячейки */
function codeSpans(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map(([, span]) => span);
}

/** Остаток ячейки без вставок кода: только разделители перечня */
const SEPARATORS = /^[\s,]*(и[\s,]*)*$/u;

/**
 * Ячейка перечисляет имена, а не описывает поведение.
 *
 * Между вставками кода стоят запятая, союз и пробелы — значит ячейка
 * собрана из имён: `testUnit`, `TestUnitOptions`. Слово вокруг вставки
 * делает ячейку прозой, и такая строка говорит о смене поведения, а не об
 * удалении имени: «отказ под `argv()` броском» оставляет `argv` живым.
 */
export function listsNames(cell) {
  return SEPARATORS.test(cell.replaceAll(/`[^`]+`/g, ''));
}

/**
 * Имя из ячейки таблицы или `null`.
 *
 * Ячейка-идентификатор даёт себя, ячейка вида `имя(…)` — имя до скобки.
 * Ячейка иной формы — `[source, keys]`, `1 ASSEMBLE`, `app.assemble(args)`
 * — именем не считается: границу проверка печатает.
 */
function identifierOf(cell) {
  return /^([$A-Z_a-z][\w$]*)(\(|$)/.exec(cell)?.[1] ?? null;
}

/** Имена markdown-файлов каталога по алфавиту */
function listMarkdown(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length))
    .sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { findings, skipped, exceptions } = checkRemovedNames();

  for (const { file, line, message } of findings) {
    console.error(`  ${file}:${line} — ${message}`);
  }

  console.error('[freshness] граница проверки');

  for (const { release, cell, reason } of skipped) {
    console.error(`  ${release}: ${cell} — ${reason}`);
  }

  for (const [name, reason] of exceptions) {
    console.error(`  исключение ${name} — ${reason}`);
  }

  if (findings.length > 0) {
    console.error(`[freshness] находок: ${findings.length}`);
    process.exit(1);
  }

  console.log('[freshness] удалённых имён в скилле нет');
}
