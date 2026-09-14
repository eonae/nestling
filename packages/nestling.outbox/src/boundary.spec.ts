/**
 * Граница сателлита: из `@nestlingjs/app` пакет берёт примитивы, а не
 * композиционный корень.
 *
 * До слияния ядра границу держал состав зависимостей — пайплайн и корень
 * лежали в разных пакетах. Теперь они в одном, и носителем гарантии стал
 * список имён: тест читает импорты поставляемого кода и сверяет их с ним.
 *
 * Проверка слабее прежней по механизму (имя ловит тест, а не резолв
 * модулей) и точнее по предмету: запрещены именно сборка приложения и
 * объявление фичи, а не всё, что лежит в пакете корня.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
  'BuiltApp',
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

describe('@nestlingjs/outbox: композиционный корень не импортируется', () => {
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
  peerDependencies?: Record<string, string>;
};

/**
 * Всё, чем пакету разрешено пользоваться в поставляемом коде.
 *
 * Валидатор в списке есть, и это не послабление: схемы своих объявлений
 * пакет пишет сам, а выбор валидатора для них — решение фреймворка.
 * Граница приложения держится не составом зависимостей, а публичными
 * типами: вендора в них нет.
 */
const ALLOWED_DEPENDENCIES = new Set([
  '@nestlingjs/common.misc',
  '@nestlingjs/app',
  '@nestlingjs/container',
  '@nestlingjs/operations',
  // Схемы своей секции и своих фактов пакет пишет сам, и пишет их на
  // вендоре фреймворка: билдеры полей приходят из его пакета, значения —
  // из zod. В публичные типы вендор при этом не попадает: тип факта
  // объявлен нейтральным
  '@nestlingjs/schema.zod',
  'zod',
]);

/**
 * Имена, которые пакет требует от дерева приложения.
 *
 * Поля два, и вид объявления выбирает тот, кто выбирает версию: свой
 * пакет — `dependencies`, стороннюю библиотеку — `peerDependencies`
 * (capability `packages-layout`). Для этой проверки поля равны: она
 * считает состав, а не раскладку.
 */
function requiredOfApplication(): string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ];
}

describe('@nestlingjs/outbox: пакет самодостаточен', () => {
  it('в зависимостях нет ничего сверх объявленного списка', () => {
    expect(requiredOfApplication().sort()).toEqual(
      [...ALLOWED_DEPENDENCIES].sort(),
    );
  });

  it('валидатор приходит peer-зависимостью, а не своей', () => {
    expect(Object.keys(manifest.peerDependencies ?? {})).toContain('zod');
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('zod');
    expect(Object.keys(manifest.devDependencies ?? {})).toContain('zod');
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
      ...requiredOfApplication(),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];

    expect(manifested.filter((name) => drivers.test(name))).toEqual([]);
  });
});
