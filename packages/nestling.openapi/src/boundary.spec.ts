/**
 * Граница пакета: генератор не знает ни одного валидатора.
 *
 * Обещание из предложения — «в `@nestling/openapi` зависимости ни от
 * одного валидатора нет» — проверяется, а не декларируется в README. Обход
 * тот же, что у `@nestling/operations`, но с двумя отличиями, и оба
 * намеренные:
 *
 * - **обход не спускается в зависимости.** Генератор серверный: он зависит
 *   от `@nestling/transport.http`, чья конфиг-секция читает zod. Утверждать
 *   «валидатора нет во всём транзитивном замыкании» было бы просто неправдой,
 *   а тест, проверяющий неправду, зелёным быть не может;
 * - **`node:*` не нарушение.** Под браузер этот пакет не собирается, и
 *   требовать от него отсутствия Node-встроенных модулей незачем.
 *
 * Плюс вторая половина того же обещания — на манифесте: валидатора нет ни
 * в `dependencies`, ни в `peerDependencies`. Конвертер приходит **данными**,
 * и его пакет (`@nestling/openapi.zod`) остаётся зависимостью пользователя.
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

/** Пакеты, которые генератору положено импортировать, и ничего сверх них */
const ALLOW = [
  '@nestling/app',
  '@nestling/container',
  '@nestling/operations',
  '@nestling/pipeline',
  '@nestling/ports',
  '@nestling/transport.http',
];

/** Валидаторы: их отсутствие в манифесте и есть предмет обещания */
const VALIDATORS = new Set([
  'zod',
  'valibot',
  'arktype',
  '@sinclair/typebox',
  'effect',
  'yup',
  'joi',
]);

describe('@nestling/openapi: package boundary', () => {
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
    const manifest = JSON.parse(
      readFileSync(resolve(packageDir, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ];

    expect(declared.filter((name) => VALIDATORS.has(name))).toEqual([]);
  });
});
