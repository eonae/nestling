/**
 * Граница пакета: один формат экспозиции и ничего от модели телеметрии.
 *
 * Пакет обещает три внутренние зависимости — ядро, контейнер и HTTP —
 * и ни одного пакета OpenTelemetry: `tap(sink)` и push по OTLP живут в
 * сателлите, а здесь только текст для сборщика.
 *
 * Обход импортов не спускается в зависимости и не считает нарушением
 * `node:*` — по тем же причинам, что у `@nestlingjs/mcp`.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectForbiddenImports,
  formatViolations,
  validatorsInTypes,
} from '../../../scripts/boundary/package-boundary.js';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, '..');

/** Пакеты, которые экспозиции положено импортировать, и ничего сверх них */
const ALLOW = [
  '@nestlingjs/app',
  '@nestlingjs/container',
  '@nestlingjs/transport.http',
];

/** Манифест пакета: то, что увидит установивший его */
function manifest(): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'));
}

/** Имена, которые пакет объявляет зависимостями рантайма */
function runtimeDependencies(): string[] {
  const { dependencies, peerDependencies } = manifest();

  return [
    ...Object.keys(dependencies ?? {}),
    ...Object.keys(peerDependencies ?? {}),
  ];
}

describe('@nestlingjs/prometheus: package boundary', () => {
  it('импортирует только объявленные пакеты фреймворка', () => {
    const violations = collectForbiddenImports({
      repoRoot: resolve(here, '../../..'),
      packageDir,
      allow: ALLOW,
      descend: false,
      allowNodeBuiltins: true,
    });

    expect(formatViolations(violations)).toBe('');
  });

  it('не называет валидатора в собранных объявлениях типов', () => {
    expect(validatorsInTypes(packageDir)).toEqual([]);
  });

  it('объявляет ровно три внутренние зависимости', () => {
    expect(runtimeDependencies().sort()).toEqual(ALLOW);
  });

  it('не зависит от OpenTelemetry', () => {
    const { dependencies, devDependencies, peerDependencies } = manifest();

    expect(
      Object.keys({
        ...dependencies,
        ...devDependencies,
        ...peerDependencies,
      }).filter((name) => name.startsWith('@opentelemetry/')),
    ).toEqual([]);
  });
});
