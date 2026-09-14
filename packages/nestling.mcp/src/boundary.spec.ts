/**
 * Граница пакета: транспорт не называет валидатора в типах и не тянет
 * HTTP-фреймворк.
 *
 * Граница валидатора проходит по публичному API, а не по составу
 * зависимостей: транспорт пишет свои отказы на zod и подставляет умолчанием
 * его конвертер, и приложению это видно только строкой в `node_modules`.
 * Вендор в **типе** отнял бы у приложения выбор собственного валидатора, и
 * сторожит его тест по собранным объявлениям.
 *
 * Обход импортов остаётся, с теми же двумя отличиями, что у
 * `@nestlingjs/openapi`:
 *
 * - **обход не спускается в зависимости.** Транспорт зависит от
 *   `@nestlingjs/transport.http`, чья конфиг-секция читает zod. Утверждать
 *   «валидатора нет во всём транзитивном замыкании» было бы неправдой;
 * - **`node:*` не нарушение.** Под браузер пакет не собирается.
 *
 * Про HTTP-фреймворк и SDK обещание прежнее и держится на манифесте: ни
 * того, ни другого в `dependencies` и `peerDependencies`. SDK стоит в
 * `devDependencies` и работает доказательством: сверкой типов и
 * интеграционным прогоном.
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

/** Пакеты, которые транспорту положено импортировать, и ничего сверх них */
const ALLOW = [
  '@nestlingjs/app',
  '@nestlingjs/container',
  '@nestlingjs/operations',
  '@nestlingjs/schema.zod',
  '@nestlingjs/transport.http',
  'zod',
];

/** HTTP-фреймворки: их приносит в дерево установки SDK, а не этот пакет */
const HTTP_FRAMEWORKS = new Set([
  '@hono/node-server',
  'express',
  'fastify',
  'hono',
  'koa',
]);

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

describe('@nestlingjs/mcp: package boundary', () => {
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

  it('не объявляет HTTP-фреймворк зависимостью рантайма', () => {
    expect(runtimeDependencies().filter((n) => HTTP_FRAMEWORKS.has(n))).toEqual(
      [],
    );
  });

  it('держит SDK только в devDependencies', () => {
    const { devDependencies } = manifest();

    expect(runtimeDependencies()).not.toContain('@modelcontextprotocol/sdk');
    expect(devDependencies).toHaveProperty('@modelcontextprotocol/sdk');
  });
});
