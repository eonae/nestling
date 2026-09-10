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
import { dirname, join } from 'node:path';
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

describe('@nestlingjs/subscriptions: композиционный корень не импортируется', () => {
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
