/**
 * Граница пакета: корневой подпуть не знает про outbox, а подпуть
 * `./outbox` не тянет его в рантайм.
 *
 * `@nestlingjs/outbox` объявлен необязательной peer-зависимостью, и
 * обещание «приложение без outbox'а ставит пакет и собирается» держится
 * именно этим: в корневом бареле его имени нет вовсе, а в подпуте оно
 * стоит только в импортах типов, которые сборка стирает.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

const srcDir = dirname(fileURLToPath(import.meta.url));

/** Поставляемый код: без спеков, проверок типов и фикстур */
function shippedFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return entry === '__fixtures__' ? [] : shippedFiles(path);
    }

    return entry.endsWith('.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.type-test.ts')
      ? [path]
      : [];
  });
}

/** Путь файла относительно `src` */
const relative = (path: string): string => path.slice(srcDir.length + 1);

/** Импорты файла из `@nestlingjs/outbox` целиком, включая перенос строк */
const OUTBOX_IMPORT =
  /import\s+(type\s+)?{[^}]*}\s+from\s+'@nestlingjs\/outbox';/g;

/** Импорты из пакета outbox'а: сам оператор и признак «только тип» */
const outboxImports = (
  source: string,
): { statement: string; typeOnly: boolean }[] =>
  [...source.matchAll(OUTBOX_IMPORT)].map(([statement, typeKeyword]) => ({
    statement: statement.replaceAll(/\s+/g, ' '),
    typeOnly: typeKeyword !== undefined,
  }));

const shipped = shippedFiles(srcDir).map((path) => ({
  file: relative(path),
  source: readFileSync(path, 'utf8'),
}));

describe('@nestlingjs/drizzle.pg: корневой подпуть не знает про outbox', () => {
  it('вне каталога `outbox` пакет не импортируется', () => {
    const found = shipped
      .filter(({ file }) => !file.startsWith('outbox/'))
      .flatMap(({ file, source }) =>
        outboxImports(source).map(({ statement }) => `${file}: ${statement}`),
      );

    expect(found).toEqual([]);
  });

  it('барель не реэкспортирует подпуть', () => {
    const barrel = readFileSync(join(srcDir, 'index.ts'), 'utf8');

    expect(barrel).not.toContain('./outbox/');
  });
});

describe('@nestlingjs/drizzle.pg/outbox: peer-зависимость нужна только типам', () => {
  it('пакет outbox импортируется только как тип', () => {
    const runtime = shipped
      .filter(({ file }) => file.startsWith('outbox/'))
      .flatMap(({ file, source }) =>
        outboxImports(source)
          .filter(({ typeOnly }) => !typeOnly)
          .map(({ statement }) => `${file}: ${statement}`),
      );

    expect(runtime).toEqual([]);
  });
});

/** Манифест пакета — источник истины про его зависимости */
const manifest = JSON.parse(
  readFileSync(resolve(srcDir, '..', 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

describe('@nestlingjs/drizzle.pg: состав зависимостей', () => {
  it('драйвер приходит peer-зависимостью, а не своей', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@nestlingjs/app',
      '@nestlingjs/common.misc',
      '@nestlingjs/container',
    ]);
    expect(Object.keys(manifest.peerDependencies ?? {})).toContain(
      'drizzle-orm',
    );
    expect(Object.keys(manifest.peerDependencies ?? {})).toContain('pg');
  });

  it('outbox — необязательная peer-зависимость', () => {
    expect(manifest.peerDependenciesMeta?.['@nestlingjs/outbox']).toEqual({
      optional: true,
    });
  });
});
