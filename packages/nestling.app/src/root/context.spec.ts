/**
 * Kernel-модуль ambient-контекста в корне.
 *
 * Предмет проверки — цена «всегда»: модуль регистрируется безусловно, но
 * без единого `Ctx(...)` в `deps` не даёт ни одного узла, а с ним — даёт
 * обычный узел графа, видимый в сериализации и подменяемый штатным
 * `valueProvider`.
 */

import type { CtxReader } from '../pipeline/index.js';
import { Ctx, RequestId } from '../pipeline/index.js';
import { wireApp } from '../testing/index.js';
import { transportValue } from '../transport/index.js';

import { loggerProbe } from './__fixtures__/logger.js';
import { makeApp } from './app.js';
import { makeFeature } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import { Injectable, makeToken } from '@nestling/container';

/** Токен транспорта-заглушки: приёма запросов в тестовом прогоне нет */
const MockTransport$ = makeToken<MockTransport>('transport:mock');

/** Куда приземляются ридеры: контейнер App не публичен */
const injected: CtxReader<string>[] = [];

@Injectable([Ctx(RequestId)])
class DeepService {
  constructor(readonly requestId: CtxReader<string>) {
    injected.push(requestId);
  }
}

const DeepModule = makeFeature({
  name: 'module:deep',
  providers: [DeepService],
});

beforeEach(() => {
  injected.length = 0;
});

describe('contextKernel в корне', () => {
  it('класс с Ctx(RequestId) собирается без единого упоминания контекста', async () => {
    const wired = await wireApp(
      makeApp({
        features: [DeepModule],
        transports: [transportValue(MockTransport$, new MockTransport())],
      }),
    );

    const service = wired.container.getOrThrow(DeepService);

    expect(service.requestId.peek()).toBeUndefined();

    await wired.close();
  });

  it('без читателей приложения единственный узел Ctx — ридер логгера ядра', async () => {
    // `ConsoleLogger` читает `requestId` из контекста, поэтому его ридер
    // есть в каждом графе с умолчанием под `RootLogger$`. Это провайдер-
    // значение ридера: узел ничего не стоит и ничего не захватывает
    const wired = await wireApp(
      makeApp({
        transports: [transportValue(MockTransport$, new MockTransport())],
      }),
    );

    const { nodes } = await wired.container.toJSON();

    expect(
      nodes.filter((node) => node.id.startsWith('Ctx:')).map((n) => n.id),
    ).toEqual(['Ctx:requestId']);

    await wired.close();
  });

  it('с подменённым корнем логгера в графе нет ни одного узла семейства Ctx', async () => {
    const probe = loggerProbe();
    const wired = await wireApp(
      makeApp({
        transports: [transportValue(MockTransport$, new MockTransport())],
        providers: [probe.provider],
      }),
    );

    const { nodes } = await wired.container.toJSON();

    expect(nodes.filter((node) => node.id.startsWith('Ctx:'))).toEqual([]);

    await wired.close();
  });

  it('узел ридера присутствует в сериализации графа', async () => {
    const wired = await wireApp(
      makeApp({
        features: [DeepModule],
        transports: [transportValue(MockTransport$, new MockTransport())],
      }),
    );

    const { nodes } = await wired.container.toJSON();
    const reader = nodes.find((node) => node.id === 'Ctx:requestId');
    const consumer = nodes.find((node) => node.id === 'DeepService');

    expect(reader).toBeDefined();
    // Зависимость от request-контекста — видимое ребро графа
    expect(consumer?.dependencies).toContain('Ctx:requestId');

    await wired.close();
  });

  it('valueProvider перекрывает рецепт семейства', async () => {
    const fake: CtxReader<string> = {
      get: () => 'fixed',
      peek: () => 'fixed',
    };

    const wired = await wireApp(
      makeApp({
        features: [DeepModule],
        transports: [transportValue(MockTransport$, new MockTransport())],
      }),
      {
        overrides: [[Ctx(RequestId), fake]],
      },
    );

    expect(wired.container.getOrThrow(DeepService).requestId).toBe(fake);

    await wired.close();
  });
});
