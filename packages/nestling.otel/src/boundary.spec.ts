/**
 * Граница пакета: модель телеметрии и ничего от транспорта.
 *
 * Пакет обещает семь зависимостей — ядро, контейнер и пять пакетов
 * OpenTelemetry. Своего endpoint'а он не объявляет, поэтому HTTP-транспорта
 * среди них нет, а формат экспозиции живёт в `@nestlingjs/prometheus`.
 *
 * Семь имён лежат в двух полях манифеста. `@opentelemetry/api`,
 * `sdk-trace-base` и `sdk-metrics` объявлены peer-зависимостями: экспортёр
 * трасс и экспортёр метрик приложение создаёт своей копией SDK и передаёт
 * опциями, поэтому копия у него и у сателлита одна. Остальные пять —
 * обычные зависимости. Счёт от этого не меняется: обещание пакета — союз
 * обоих полей.
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

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, '..');

/**
 * Пакеты SDK, чьи значения пересекают границу пакета.
 *
 * Экспортёры приходят опциями `traces` и `metrics`, а `ValueType`,
 * `SpanKind` и перечисления точек снимка приходят из `api` и `sdk-metrics`
 * значениями. Копия обязана быть одна, поэтому имена объявлены peer.
 */
const SHARED_WITH_APPLICATION = [
  '@opentelemetry/api',
  '@opentelemetry/sdk-metrics',
  '@opentelemetry/sdk-trace-base',
];

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

  it('копия SDK у приложения и у сателлита одна', () => {
    const { dependencies, peerDependencies, devDependencies } = manifest();

    for (const name of SHARED_WITH_APPLICATION) {
      expect(Object.keys(peerDependencies ?? {})).toContain(name);
      expect(Object.keys(dependencies ?? {})).not.toContain(name);
      // Peer объявляет требование к приложению, dev даёт сборке и спекам
      // что импортировать
      expect(Object.keys(devDependencies ?? {})).toContain(name);
    }
  });

  it('ресурс и семантические соглашения остаются своими', () => {
    expect(Object.keys(manifest().dependencies ?? {}).sort()).toEqual([
      '@nestlingjs/app',
      '@nestlingjs/container',
      '@opentelemetry/resources',
      '@opentelemetry/semantic-conventions',
    ]);
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
