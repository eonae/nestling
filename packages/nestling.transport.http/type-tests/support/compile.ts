/**
 * Оснастка компилятора для снапшот-тестов диагностик.
 *
 * Копия `packages/nestling.pipeline/type-tests/support/compile.ts` без
 * части про бюджет типов: у этого пакета бюджета нет. Потребителей
 * оснастки два, поэтому она копируется, а не выносится в пакет.
 *
 * Над всем каталогом фикстур создаётся **одна** программа. Программа на
 * фикстуру стоит 2+ секунды каждая; одна программа на каталог — единицы
 * секунд на весь набор.
 */

import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));

/** `packages/nestling.transport.http/type-tests` */
const typeTestsDir = resolve(here, '..');

/** Корень монорепозитория — база для нормализации путей в диагностиках */
const repoRoot = resolve(typeTestsDir, '..', '..', '..');

const fixturesDir = resolve(typeTestsDir, 'fixtures');

/**
 * Читает tsconfig и возвращает разобранные опции вместе со списком файлов.
 */
function readConfig(configPath: string): ts.ParsedCommandLine {
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  if (raw.error) {
    throw new Error(formatDiagnostic(raw.error));
  }

  const parsed = ts.parseJsonConfigFileContent(
    raw.config,
    ts.sys,
    dirname(configPath),
  );
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((d) => formatDiagnostic(d)).join('\n'));
  }

  return parsed;
}

/** Создаёт программу по tsconfig */
function createProgram(configPath: string): ts.Program {
  const parsed = readConfig(configPath);
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
}

const formatHost: ts.FormatDiagnosticsHost = {
  // Пути в диагностиках становятся относительными корня репозитория:
  // снапшот не зависит от того, где склонирован репозиторий.
  getCurrentDirectory: () => repoRoot,
  getCanonicalFileName: (fileName) => fileName,
  // Переводы строк — всегда `\n`, независимо от платформы.
  getNewLine: () => '\n',
};

/**
 * Нормализованный текст одной диагностики.
 *
 * Номера строк и колонок **сохраняются** — они часть полезного сигнала.
 * Усечение длинных типов компилятором намеренно НЕ отключается
 * (`--noErrorTruncation` не ставится): снапшот обязан фиксировать текст
 * таким, каким его видит пользователь в редакторе.
 */
function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.formatDiagnostic(diagnostic, formatHost).replace(/\n+$/, '');
}

/** Имена файлов фикстур (без расширения), отсортированные */
export function fixtureNames(): string[] {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => name.replace(/\.ts$/, ''))
    .sort();
}

/**
 * Компилирует весь каталог фикстур одной программой и группирует
 * нормализованные тексты диагностик по файлу.
 *
 * @returns карта «имя фикстуры → текст всех её диагностик»
 */
export function compileFixtures(): Map<string, string> {
  const program = createProgram(resolve(typeTestsDir, 'tsconfig.json'));
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const byFixture = new Map<string, string[]>();
  for (const name of fixtureNames()) {
    byFixture.set(name, []);
  }

  for (const diagnostic of diagnostics) {
    const fileName = diagnostic.file?.fileName;
    if (!fileName?.startsWith(fixturesDir)) {
      // Диагностики из исходников пакетов (если появятся) — не предмет
      // этих снапшотов; их ловит `build`.
      continue;
    }

    const fixture = fileName.slice(fixturesDir.length + 1).replace(/\.ts$/, '');
    const bucket = byFixture.get(fixture);
    if (bucket) {
      bucket.push(formatDiagnostic(diagnostic));
    }
  }

  return new Map(
    [...byFixture].map(([name, texts]) => [
      name,
      texts.length > 0 ? texts.join('\n\n') : '(no diagnostics)',
    ]),
  );
}
