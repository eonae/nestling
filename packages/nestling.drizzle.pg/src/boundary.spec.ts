/**
 * Граница пакета: корневой подпуть не знает про сателлитов, а их
 * подпути не тянут их в рантайм.
 *
 * `@nestlingjs/outbox` и `@nestlingjs/inbox` объявлены необязательными
 * peer-зависимостями, и обещание «приложение без них ставит пакет и
 * собирается» держится именно этим: в корневом бареле их имён нет вовсе,
 * а в подпутях они стоят только в импортах типов, которые сборка стирает.
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

/** Импорты файла из пакета-сателлита целиком, включая перенос строк */
const satelliteImport = (name: string): RegExp =>
  new RegExp(
    String.raw`import\s+(type\s+)?\{[^}]*\}\s+from\s+'@nestlingjs/${name}';`,
    'g',
  );

/** Импорты из пакета-сателлита: сам оператор и признак «только тип» */
const satelliteImports = (
  source: string,
  name: string,
): { statement: string; typeOnly: boolean }[] =>
  [...source.matchAll(satelliteImport(name))].map(
    ([statement, typeKeyword]) => ({
      statement: statement.replaceAll(/\s+/g, ' '),
      typeOnly: typeKeyword !== undefined,
    }),
  );

const shipped = shippedFiles(srcDir).map((path) => ({
  file: relative(path),
  source: readFileSync(path, 'utf8'),
}));

/** Сателлиты, каждый со своим каталогом подпути */
const SATELLITES = ['outbox', 'inbox'] as const;

for (const satellite of SATELLITES) {
  describe(`@nestlingjs/drizzle.pg: корневой подпуть не знает про ${satellite}`, () => {
    it(`вне каталога \`${satellite}\` пакет не импортируется`, () => {
      const found = shipped
        .filter(({ file }) => !file.startsWith(`${satellite}/`))
        .flatMap(({ file, source }) =>
          satelliteImports(source, satellite).map(
            ({ statement }) => `${file}: ${statement}`,
          ),
        );

      expect(found).toEqual([]);
    });

    it('барель не реэкспортирует подпуть', () => {
      const barrel = readFileSync(join(srcDir, 'index.ts'), 'utf8');

      expect(barrel).not.toContain(`./${satellite}/`);
    });
  });

  describe(`@nestlingjs/drizzle.pg/${satellite}: peer-зависимость нужна только типам`, () => {
    it(`пакет ${satellite} импортируется только как тип`, () => {
      const runtime = shipped
        .filter(({ file }) => file.startsWith(`${satellite}/`))
        .flatMap(({ file, source }) =>
          satelliteImports(source, satellite)
            .filter(({ typeOnly }) => !typeOnly)
            .map(({ statement }) => `${file}: ${statement}`),
        );

      expect(runtime).toEqual([]);
    });
  });
}

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

  it('сателлиты — необязательные peer-зависимости', () => {
    for (const satellite of SATELLITES) {
      expect(
        manifest.peerDependenciesMeta?.[`@nestlingjs/${satellite}`],
      ).toEqual({ optional: true });
    }
  });
});
