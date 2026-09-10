/**
 * Граница пакета: клиент собирается для браузера.
 *
 * Тот же обход замыкания `dist/`, что у `@nestlingjs/operations`: белый список
 * расширен ровно на сам пакет операций, потому что его замыкание клиент
 * наследует целиком.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectForbiddenImports,
  formatViolations,
} from '../../../scripts/boundary/package-boundary.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('@nestlingjs/client: граница пакета', () => {
  it('не импортирует серверный код и Node-специфику', () => {
    const violations = collectForbiddenImports({
      repoRoot: resolve(here, '../../..'),
      packageDir: resolve(here, '..'),
      allow: [
        '@nestlingjs/common.misc',
        '@nestlingjs/container/tokens',
        '@nestlingjs/operations',
        '@standard-schema/spec',
      ],
    });

    expect(formatViolations(violations)).toBe('');
  });
});
