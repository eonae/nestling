/**
 * Граница пакета: модель телеметрии и ничего от транспорта.
 *
 * Пакет обещает семь зависимостей — ядро, контейнер и пять пакетов
 * OpenTelemetry. Своего endpoint'а он не объявляет, поэтому HTTP-транспорта
 * среди них нет, а формат экспозиции живёт в `@nestlingjs/prometheus`.
 *
 * Обход импортов не спускается в зависимости — по тем же причинам, что у
 * `@nestlingjs/prometheus`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectForbiddenImports,
  formatViolations,
  readSpecifiers,
  validatorsInTypes,
} from '../../../scripts/boundary/package-boundary.js';

import { describe, expect, it } from '@jest/globals';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, '..');

/** Пакеты, которые сателлиту положено импортировать, и ничего сверх них */
const ALLOW = [
  '@nestlingjs/app',
  '@nestlingjs/container',
  '@opentelemetry/api',
  '@opentelemetry/resources',
  '@opentelemetry/sdk-metrics',
  '@opentelemetry/sdk-trace-base',
  '@opentelemetry/semantic-conventions',
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

/** Прод-код пакета: спеки и проверки типов в границу не входят */
function sources(): string[] {
  return readdirSync(resolve(packageDir, 'src'))
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => !/\.(?:spec|type-test)\.ts$/.test(name))
    .map((name) => readFileSync(resolve(packageDir, 'src', name), 'utf8'));
}

/**
 * Пакеты, которые импортирует прод-код.
 *
 * Считается по исходникам, а не по `dist`: импорт одних только типов
 * компилятор стирает, и зависимость, нужная для сборки потребителя, в
 * собранном коде не видна.
 */
function importedPackages(): string[] {
  const imported = new Set<string>();

  for (const source of sources()) {
    for (const specifier of readSpecifiers(source)) {
      if (!specifier.startsWith('.')) {
        imported.add(specifier);
      }
    }
  }

  return [...imported];
}

describe('@nestlingjs/otel: package boundary', () => {
  it('импортирует только объявленные пакеты', () => {
    const violations = collectForbiddenImports({
      repoRoot: resolve(here, '../../..'),
      packageDir,
      allow: ALLOW,
      descend: false,
    });

    expect(formatViolations(violations)).toBe('');
  });

  it('не называет валидатора в собранных объявлениях типов', () => {
    expect(validatorsInTypes(packageDir)).toEqual([]);
  });

  it('объявляет ровно семь зависимостей', () => {
    expect(runtimeDependencies().sort()).toEqual(ALLOW);
  });

  it('объявляет всё, что импортирует', () => {
    expect(importedPackages().sort()).toEqual(ALLOW);
  });

  it('не зависит ни от транспорта, ни от формата экспозиции', () => {
    const { dependencies, devDependencies, peerDependencies } = manifest();
    const all = Object.keys({
      ...dependencies,
      ...devDependencies,
      ...peerDependencies,
    });

    expect(all).not.toContain('@nestlingjs/transport.http');
    expect(all).not.toContain('@opentelemetry/exporter-prometheus');
  });
});
