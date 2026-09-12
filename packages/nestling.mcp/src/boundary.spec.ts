/**
 * Граница пакета: транспорт не знает ни валидатора, ни HTTP-фреймворка.
 *
 * Обещание из предложения — «зависимостей рантайма от валидатора и от SDK
 * у пакета нет» — проверяется, а не декларируется в README. Обход тот же,
 * что у `@nestlingjs/openapi`, и с теми же двумя отличиями:
 *
 * - **обход не спускается в зависимости.** Транспорт зависит от
 *   `@nestlingjs/transport.http`, чья конфиг-секция читает zod. Утверждать
 *   «валидатора нет во всём транзитивном замыкании» было бы неправдой;
 * - **`node:*` не нарушение.** Под браузер пакет не собирается.
 *
 * Плюс вторая половина обещания — на манифесте: ни валидатора, ни
 * HTTP-фреймворка, ни SDK в `dependencies` и `peerDependencies`. SDK стоит
 * в `devDependencies` и работает доказательством: сверкой типов и
 * интеграционным прогоном.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectForbiddenImports,
  formatViolations,
} from '../../../scripts/boundary/package-boundary.js';

import { describe, expect, it } from '@jest/globals';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, '..');

/** Пакеты, которые транспорту положено импортировать, и ничего сверх них */
const ALLOW = [
  '@nestlingjs/app',
  '@nestlingjs/container',
  '@nestlingjs/operations',
  '@nestlingjs/transport.http',
];

/** Валидаторы: их отсутствие в манифесте и есть предмет обещания */
const VALIDATORS = new Set([
  '@sinclair/typebox',
  'arktype',
  'effect',
  'joi',
  'valibot',
  'yup',
  'zod',
]);

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

  it('не объявляет валидатор ни в dependencies, ни в peerDependencies', () => {
    expect(runtimeDependencies().filter((n) => VALIDATORS.has(n))).toEqual([]);
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
