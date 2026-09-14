/**
 * Спека проверки раскладки зависимостей.
 *
 * Прогоняется встроенным раннером Node: файл лежит в `scripts/`, а vitest
 * в репозитории запускается по пакетам и сюда не заглядывает.
 *
 * Прогон: `node --test scripts/boundary/manifest-deps.spec.mjs` (входит в
 * `yarn verify` рядом с самой проверкой).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EXEMPT,
  strayDeclarations,
  strayDependencies,
} from './manifest-deps.mjs';

describe('strayDependencies', () => {
  it('ловит библиотеку, объявленную мимо списка', () => {
    const manifest = {
      dependencies: { '@nestlingjs/app': 'workspace:*', zod: '^4.0.0' },
    };

    assert.deepEqual(strayDependencies(manifest), ['zod']);
  });

  it('молчит на имени из списка исключений', () => {
    const manifest = {
      dependencies: {
        '@nestlingjs/app': 'workspace:*',
        'find-my-way': '^9.7.0',
      },
    };

    assert.deepEqual(strayDependencies(manifest), []);
  });

  it('молчит на пакете своего скоупа', () => {
    const manifest = {
      dependencies: { '@nestlingjs/container': 'workspace:*' },
    };

    assert.deepEqual(strayDependencies(manifest), []);
  });

  it('peer и dev не считает: правило про `dependencies`', () => {
    const manifest = {
      peerDependencies: { zod: '^4.0.0' },
      devDependencies: { zod: '^4.0.0' },
    };

    assert.deepEqual(strayDependencies(manifest), []);
  });

  it('манифест без зависимостей расхождения не даёт', () => {
    assert.deepEqual(strayDependencies({}), []);
  });
});

describe('strayDeclarations', () => {
  it('называет пакет и зависимость', () => {
    const packages = [
      { name: '@nestlingjs/inbox', pkg: { dependencies: { zod: '^4.0.0' } } },
    ];

    assert.deepEqual(strayDeclarations(packages), [
      { package: '@nestlingjs/inbox', dependency: 'zod' },
    ]);
  });

  it('приватный пакет не проверяется: его в списке нет', () => {
    // `publishablePackages()` отбрасывает `private: true`, поэтому
    // `@nestlingjs/viz` со своими `react` и `commander` до проверки не
    // доходит
    const published = [
      {
        name: '@nestlingjs/viz',
        pkg: { private: true, dependencies: { react: '^18.2.0' } },
      },
    ].filter(({ pkg }) => !pkg.private);

    assert.deepEqual(strayDeclarations(published), []);
  });
});

describe('список исключений', () => {
  it('у каждого имени записана причина', () => {
    for (const [name, reason] of EXEMPT) {
      assert.ok(reason.length > 0, `${name}: причина не записана`);
    }
  });
});
