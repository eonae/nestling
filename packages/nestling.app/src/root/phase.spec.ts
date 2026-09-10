/**
 * Фаза приложения глазами узла ядра: RUN во время обслуживания, SHUTDOWN
 * после остановки, RUN в тестовом прогоне и отсутствие DI-токена фазы.
 */

import type { Health } from '../health/index.js';
import { Health$ } from '../health/index.js';
import { transportValue } from '../transport/index.js';

import { ALL_FORMS, TestTransport$ } from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { makeFeature } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import { Component, makeModule } from '@nestlingjs/container';

/** Ловит узел проб из графа: снаружи собранное приложение его не отдаёт */
let captured: Health | undefined;

@Component([Health$])
class HealthProbe {
  constructor(health: Health) {
    captured = health;
  }
}

/** Приложение без endpoint'ов: фазы проходят и без них */
const declaration = () =>
  makeApp({
    features: [
      makeFeature({
        name: 'probe',
        modules: [
          makeModule({ name: 'module:probe', providers: [HealthProbe] }),
        ],
      }),
    ],
    transports: [
      transportValue(TestTransport$('default'), new MockTransport(), {
        capabilities: ALL_FORMS,
      }),
    ],
  });

/** Узел проб текущей сборки; до INIT его не существует */
const probe = (): Health => {
  if (!captured) {
    throw new Error('Health node was not captured');
  }

  return captured;
};

beforeEach(() => {
  captured = undefined;
});

describe('фаза приложения', () => {
  it('во время обслуживания запросов узел ядра читает RUN', async () => {
    const app = declaration().assemble();

    await app.run();

    try {
      await expect(probe().readiness()).resolves.toMatchObject({
        phase: 'RUN',
        status: 'ready',
      });
    } finally {
      await app.close();
    }
  });

  it('после сигнала остановки узел ядра читает SHUTDOWN', async () => {
    const app = declaration().assemble();

    await app.run();

    const health = probe();
    await app.close();

    await expect(health.readiness()).resolves.toMatchObject({
      phase: 'SHUTDOWN',
      status: 'not_ready',
    });
  });

  it('тестовый корень сообщает RUN', async () => {
    const { wireApp } = await import('../testing/index.js');
    const wired = await wireApp(declaration());

    try {
      await expect(
        wired.container.getOrThrow<Health>(Health$).readiness(),
      ).resolves.toMatchObject({ phase: 'RUN', status: 'ready' });
    } finally {
      await wired.close();
    }
  });

  it('DI-токена текущей фазы в публичных экспортах нет', async () => {
    const exported = await import('../index.js');

    expect(Object.keys(exported).filter((name) => /phase/i.test(name))).toEqual(
      [],
    );
  });
});
