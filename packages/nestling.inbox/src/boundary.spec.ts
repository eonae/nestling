/**
 * Граница сателлита: из `@nestlingjs/app` пакет берёт примитивы, а не
 * композиционный корень.
 *
 * Носитель гарантии — список имён: тест читает импорты поставляемого кода
 * и сверяет их с ним. Запрещены именно сборка приложения и объявление
 * фичи, а не всё, что лежит в пакете корня.
 *
 * Второе утверждение — про состав зависимостей: драйвера базы данных в
 * пакете нет и не появится.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

const srcDir = dirname(fileURLToPath(import.meta.url));

/**
 * Имена композиционного корня, которых в поставляемом коде быть не должно.
 *
 * Сборка приложения и объявление фичи — работа того, кто собирает
 * приложение. Сателлит же отдаётся плагином, поэтому `makePlugin` и
 * `Plugin` в списке нет: это форма поставки пакета, а не сборка.
 */
const FORBIDDEN = new Set([
  'makeApp',
  'App',
  'AssembledApp',
  'isApp',
  'makeFeature',
  'Feature',
  'FeatureOptions',
  'FeatureSelection',
  'resolveSelection',
  'Discovery$',
]);

/** Поставляемый код: без спеков и фикстур — их в `dist` нет */
function shippedFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return entry === '__fixtures__' ? [] : shippedFiles(path);
    }

    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Имена, импортированные файлом из `@nestlingjs/app` */
function importedFromApp(source: string): string[] {
  const named = /import\s+(?:type\s+)?{([^}]*)}\s+from\s+'@nestlingjs\/app';/g;

  return [...source.matchAll(named)].flatMap(([, clause]) =>
    clause
      .split(',')
      .map((name) => name.replace(/^\s*type\s+/, '').trim())
      // Псевдоним не прячет имя: сверяется импортированное, а не локальное
      .map((name) => name.split(/\s+as\s+/)[0].trim())
      .filter(Boolean),
  );
}

const imported = new Map(
  shippedFiles(srcDir).map((path) => [
    path.slice(srcDir.length + 1),
    importedFromApp(readFileSync(path, 'utf8')),
  ]),
);

describe('@nestlingjs/inbox: композиционный корень не импортируется', () => {
  it('среди импортированных имён нет сборки приложения и объявления фичи', () => {
    const found = [...imported].flatMap(([file, names]) =>
      names
        .filter((name) => FORBIDDEN.has(name))
        .map((name) => `${file}: ${name}`),
    );

    expect(found).toEqual([]);
  });

  it('пакет отдаётся плагином: makePlugin импортирован', () => {
    expect([...imported.values()].flat()).toContain('makePlugin');
  });

  it('импорт целиком (`import * as`) не обходит проверку', () => {
    const wildcard = shippedFiles(srcDir).filter((path) =>
      /import\s+\*\s+as\s+\w+\s+from\s+'@nestlingjs\/app';/.test(
        readFileSync(path, 'utf8'),
      ),
    );

    expect(wildcard).toEqual([]);
  });
});

/** Манифест пакета — источник истины про его зависимости */
const manifest = JSON.parse(
  readFileSync(resolve(srcDir, '..', 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** Всё, чем пакету разрешено пользоваться в поставляемом коде */
const ALLOWED_DEPENDENCIES = new Set([
  '@nestlingjs/common.misc',
  '@nestlingjs/app',
  '@nestlingjs/container',
]);

describe('@nestlingjs/inbox: пакет самодостаточен', () => {
  it('в зависимостях нет ничего, кроме пакетов монорепы', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...ALLOWED_DEPENDENCIES].sort(),
    );
  });

  it('поставляемый код не импортирует ничего сверх этого списка', () => {
    const external = /from\s+'([^'.][^']*)'/g;

    const found = shippedFiles(srcDir).flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(external)]
        .map(([, specifier]) => specifier)
        // Subpath пакета монорепы (`@nestlingjs/container/tokens`) считается
        // тем же пакетом
        .map((specifier) =>
          specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0],
        )
        .filter((name) => !ALLOWED_DEPENDENCIES.has(name)),
    );

    expect([...new Set(found)]).toEqual([]);
  });

  it('драйвера базы данных в пакете нет', () => {
    const drivers =
      /\b(pg|mysql2?|better-sqlite3|mongodb|knex|prisma|drizzle|typeorm|sequelize)\b/;
    const manifested = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];

    expect(manifested.filter((name) => drivers.test(name))).toEqual([]);
  });

  it('импорты идут из публичных барелей, а не из подпутей', () => {
    const external = /from\s+'(@nestlingjs\/[^']*)'/g;

    const subpaths = shippedFiles(srcDir).flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(external)]
        .map(([, specifier]) => specifier)
        // `@nestlingjs/common.misc` — имя пакета, а не подпуть: сегментов
        // после области ровно один у обеих форм
        .filter((specifier) => specifier.split('/').length > 2),
    );

    expect([...new Set(subpaths)]).toEqual([]);
  });
});

/** Словарь сборки: он решает, что попадёт в `dist` */
const buildConfig = readFileSync(
  resolve(srcDir, '..', 'tsconfig.build.json'),
  'utf8',
);

describe('@nestlingjs/inbox: тестовый код в сборку не уходит', () => {
  it('словарь сборки исключает спеки, проверки типов и фикстуры', () => {
    for (const pattern of [
      'src/**/*.spec.ts',
      'src/**/*.test.ts',
      'src/**/*.type-test.ts',
      'src/**/__fixtures__/**',
    ]) {
      expect(buildConfig).toContain(pattern);
    }
  });
});
