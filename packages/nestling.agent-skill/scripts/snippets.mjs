/* eslint-disable no-console */
/* eslint-disable unicorn/no-process-exit */

/**
 * Сверка блоков кода в скилле с файлами `snippets/`.
 *
 * Каждый блок на TypeScript помечен строкой `<!-- snippet: <файл> -->`
 * перед открывающей оградой и повторяет названный файл посимвольно. Файл
 * компилируется вместе с пакетом, поэтому расхождение блока с файлом
 * означает, что текст скилла отстал от API.
 *
 * Прогон: `node scripts/snippets.mjs` — сверка, `--write` — перезапись
 * блоков из файлов. Сверку вызывает и `src/snippets.spec.ts`.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Каталог скилла: markdown, который читает агент */
export const SKILL_DIR = fileURLToPath(new URL('../skill/', import.meta.url));

/** Каталог сниппетов: компилируемые файлы, которых в тарболе нет */
export const SNIPPETS_DIR = fileURLToPath(
  new URL('../snippets/', import.meta.url),
);

/** Язык, на котором пишутся блоки со сниппетами */
const LANGUAGE = 'typescript';

const MARKER = /^<!-- snippet: (.+) -->$/;
const FENCE = /^```(\w*)$/;

/**
 * Сверяет блоки кода с файлами сниппетов в обе стороны.
 *
 * @returns Список находок; пустой список означает, что всё сходится
 */
export function checkSnippets() {
  const findings = [];
  const used = new Set();

  for (const markdown of listFiles(SKILL_DIR, '.md')) {
    const { blocks, problems } = parse(read(SKILL_DIR, markdown), markdown);
    findings.push(...problems);

    for (const block of blocks) {
      used.add(block.snippet);

      const source = readSnippet(block.snippet);

      if (source === null) {
        findings.push({
          file: markdown,
          line: block.line,
          message:
            `блок ссылается на snippets/${block.snippet}, ` +
            `а такого файла нет`,
        });
      } else if (source !== block.body) {
        findings.push({
          file: markdown,
          line: block.line,
          message:
            `блок разошёлся с snippets/${block.snippet}; ` +
            `перезаписать — yarn workspace @nestlingjs/agent-skill snippets`,
        });
      }
    }
  }

  for (const snippet of listFiles(SNIPPETS_DIR, '.ts')) {
    if (!used.has(snippet)) {
      findings.push({
        file: `snippets/${snippet}`,
        line: 1,
        message: 'на файл не ссылается ни один блок кода в скилле',
      });
    }
  }

  return findings;
}

/**
 * Переписывает тела помеченных блоков содержимым файлов сниппетов.
 *
 * @returns Имена markdown-файлов, которые изменились
 */
export function writeSnippets() {
  const changed = [];

  for (const markdown of listFiles(SKILL_DIR, '.md')) {
    const text = read(SKILL_DIR, markdown);
    const { blocks } = parse(text, markdown);
    const lines = text.split('\n');

    // С конца: замена тела блока сдвигает номера строк ниже по файлу
    for (const block of [...blocks].reverse()) {
      const source = readSnippet(block.snippet);

      if (source === null) {
        continue;
      }

      lines.splice(block.start, block.end - block.start, ...source.split('\n'));
    }

    const next = lines.join('\n');

    if (next !== text) {
      writeFileSync(join(SKILL_DIR, markdown), next);
      changed.push(markdown);
    }
  }

  return changed;
}

/**
 * Разбирает markdown на помеченные блоки и находки разметки.
 *
 * @param text - Содержимое файла
 * @param file - Имя файла для находок
 */
function parse(text, file) {
  const lines = text.split('\n');
  const blocks = [];
  const problems = [];

  for (let index = 0; index < lines.length; index++) {
    const marked = MARKER.exec(lines[index]);
    const fence = FENCE.exec(lines[index]);

    if (marked) {
      const opening = FENCE.exec(lines[index + 1] ?? '');

      if (opening?.[1] !== LANGUAGE) {
        problems.push({
          file,
          line: index + 1,
          message: `за пометкой не идёт блок \`\`\`${LANGUAGE}`,
        });
        continue;
      }

      const start = index + 2;
      const end = closingFence(lines, start);

      if (end === -1) {
        problems.push({
          file,
          line: index + 1,
          message: 'блок не закрыт оградой',
        });
        break;
      }

      blocks.push({
        snippet: marked[1].trim(),
        line: index + 1,
        start,
        end,
        body: lines.slice(start, end).join('\n'),
      });
      index = end;
    } else if (fence) {
      const end = closingFence(lines, index + 1);

      if (fence[1] === LANGUAGE) {
        problems.push({
          file,
          line: index + 1,
          message: `блок \`\`\`${LANGUAGE} без пометки <!-- snippet: … -->`,
        });
      }

      index = end === -1 ? lines.length : end;
    }
  }

  return { blocks, problems };
}

/** Номер строки закрывающей ограды или -1 */
function closingFence(lines, from) {
  for (let index = from; index < lines.length; index++) {
    if (lines[index] === '```') {
      return index;
    }
  }

  return -1;
}

/** Содержимое сниппета без завершающего перевода строки или null */
function readSnippet(name) {
  try {
    return readFileSync(join(SNIPPETS_DIR, name), 'utf8').replace(/\n$/, '');
  } catch {
    return null;
  }
}

function read(dir, name) {
  return readFileSync(join(dir, name), 'utf8');
}

/** Пути файлов каталога с нужным расширением относительно него, по алфавиту */
function listFiles(dir, extension) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    const changed = writeSnippets();

    console.log(
      changed.length === 0
        ? '[snippets] блоки уже совпадают с файлами'
        : `[snippets] переписано: ${changed.join(', ')}`,
    );
  } else {
    const findings = checkSnippets();

    for (const { file, line, message } of findings) {
      console.error(`  ${file}:${line} — ${message}`);
    }

    if (findings.length > 0) {
      console.error(`[snippets] находок: ${findings.length}`);
      process.exit(1);
    }

    console.log('[snippets] блоки и файлы сходятся');
  }
}
