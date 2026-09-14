/**
 * Граница пакета: адаптеру нужен интерфейс, а не композиционный корень.
 *
 * `@nestlingjs/app` в дереве сателлита означал бы, что логгер нельзя взять
 * скриптом рядом с приложением, — а его берут именно так. Сам pino
 * приходит peer-зависимостью: версию выбирает приложение, и второй копии
 * библиотеки в дереве быть не должно.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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

const shipped = shippedFiles(srcDir).map((path) => ({
  file: path.slice(srcDir.length + 1),
  source: readFileSync(path, 'utf8'),
}));

/** Манифест пакета — источник истины про его зависимости */
const manifest = JSON.parse(
  readFileSync(resolve(srcDir, '..', 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe('@nestlingjs/logging.pino: ядро в пакет не входит', () => {
  it('поставляемый код не импортирует @nestlingjs/app', () => {
    const found = shipped
      .filter(({ source }) => source.includes('@nestlingjs/app'))
      .map(({ file }) => file);

    expect(found).toEqual([]);
  });

  it('манифест не называет @nestlingjs/app', () => {
    expect(JSON.stringify(manifest)).not.toContain('@nestlingjs/app');
  });
});

describe('@nestlingjs/logging.pino: состав зависимостей', () => {
  it('своя зависимость одна — интерфейс логгера', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([
      '@nestlingjs/logging',
    ]);
  });

  it('pino приходит peer-зависимостью', () => {
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual(['pino']);
  });
});

describe('@nestlingjs/logging.pino: барель', () => {
  const barrel = readFileSync(join(srcDir, 'index.ts'), 'utf8');

  it('отдаёт два имени и ничего больше', () => {
    expect(barrel).toContain("export { pinoLogger } from './logger.js';");
    expect(barrel).toContain(
      "export type { PinoLoggerOptions } from './logger.js';",
    );
  });

  it('не реэкспортирует модуль целиком', () => {
    expect(barrel).not.toContain('export *');
  });
});
