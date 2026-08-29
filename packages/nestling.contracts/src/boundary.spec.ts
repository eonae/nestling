/**
 * Граница пакета: граф импортов собранного `dist/` не доходит до
 * серверного кода, барреля контейнера и модулей Node.
 *
 * Проверяется `dist/`, а не `src/`: типовые импорты компилятор удаляет, а
 * оставшиеся действительно выполняются у потребителя.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectForbiddenImports,
  formatViolations,
} from '../../../scripts/boundary/package-boundary.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, '..');
const repoRoot = resolve(here, '../../..');

/**
 * Разрешённые импорты.
 *
 * `@nestling/container/tokens` записан subpath'ом: баррель пакета в список
 * не входит, и импорт из него — нарушение.
 */
const ALLOW = [
  '@common/misc',
  '@nestling/container/tokens',
  '@nestling/streams',
  '@standard-schema/spec',
];

describe('@nestling/contracts: package boundary', () => {
  it('does not reach server code, the container barrel or node built-ins', () => {
    const violations = collectForbiddenImports({
      repoRoot,
      packageDir,
      allow: ALLOW,
    });

    expect(formatViolations(violations)).toBe('');
  });

  it('reports the module and the specifier of a forbidden import', () => {
    const fixture = mkdtempSync(resolve(tmpdir(), 'nestling-boundary-'));

    try {
      mkdirSync(resolve(fixture, 'dist'));
      writeFileSync(
        resolve(fixture, 'package.json'),
        JSON.stringify({
          name: 'fixture',
          exports: { '.': { import: './dist/index.js' } },
        }),
      );
      writeFileSync(
        resolve(fixture, 'dist/index.js'),
        [
          "export * from './leaf.js';",
          // Упоминание запрещённого пакета в комментарии импортом не является
          '// см. @nestling/pipeline — from "@nestling/pipeline"',
          "export { ok } from '@common/misc';",
        ].join('\n'),
      );
      writeFileSync(
        resolve(fixture, 'dist/leaf.js'),
        [
          "import { createHash } from 'node:crypto';",
          "import { Fail } from '@nestling/pipeline';",
          'export const leaf = () => [createHash, Fail];',
        ].join('\n'),
      );

      const violations = collectForbiddenImports({
        repoRoot: fixture,
        packageDir: fixture,
        allow: ALLOW,
      });

      expect(violations).toHaveLength(2);
      expect(violations.map((v) => v.specifier).sort()).toEqual([
        '@nestling/pipeline',
        'node:crypto',
      ]);
      expect(violations.every((v) => v.module === 'dist/leaf.js')).toBe(true);

      const text = formatViolations(violations);
      expect(text).toContain('dist/leaf.js');
      expect(text).toContain('@nestling/pipeline');
      expect(text).toContain('node:crypto');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
