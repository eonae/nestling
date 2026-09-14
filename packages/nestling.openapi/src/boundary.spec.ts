/**
 * Граница пакета: генератор не называет валидатора в типах.
 *
 * Граница проходит по публичному API, а не по составу зависимостей.
 * Генератор зависит от `@nestlingjs/schema.zod` — это выбор реализации:
 * конвертер вендора, на котором написаны схемы фреймворка, подставляется
 * умолчанием, и приложению эта зависимость видна только строкой в
 * `node_modules`. А вот вендор в **типе** отнял бы у приложения выбор
 * собственного валидатора, и вот его тест и сторожит — по собранным
 * объявлениям.
 *
 * Обход импортов остаётся, с двумя намеренными отличиями:
 *
 * - **обход не спускается в зависимости.** Генератор серверный: он зависит
 *   от `@nestlingjs/transport.http`, чья конфиг-секция читает zod. Утверждать
 *   «валидатора нет во всём транзитивном замыкании» было бы просто неправдой,
 *   а тест, проверяющий неправду, зелёным быть не может;
 * - **`node:*` не нарушение.** Под браузер этот пакет не собирается, и
 *   требовать от него отсутствия Node-встроенных модулей незачем.
 */

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

/** Пакеты, которые генератору положено импортировать, и ничего сверх них */
const ALLOW = [
  '@nestlingjs/app',
  '@nestlingjs/container',
  '@nestlingjs/operations',
  '@nestlingjs/schema.zod',
  '@nestlingjs/transport.http',
];

describe('@nestlingjs/openapi: package boundary', () => {
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
});
