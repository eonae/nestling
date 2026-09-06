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
import { VALUE_ONLY } from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { makeFeature } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import { Component, makeToken } from '@nestling/container';

/** DI-токен транспорта-заглушки: приёма запросов в тестовом прогоне нет */
const MockTransport$ = makeToken<MockTransport>('transport:mock');

/** Куда приземляются ридеры: контейнер App не публичен */
const injected: CtxReader<string>[] = [];

@Component([Ctx(RequestId)])
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
        transports: [
          transportValue(MockTransport$, new MockTransport(), {
            capabilities: VALUE_ONLY,
          }),
        ],
      }),
    );

    const service = wired.container.getOrThrow(DeepService);

    expect(service.requestId.peek()).toBeUndefined();

    await wired.close();
  });

  it('без читателей приложения ни один узел Ctx не создаётся', async () => {
    // `ConsoleLogger` (логгер по умолчанию) читает `requestId` из
    // ambient-контекста напрямую, минуя DI: корень создаётся на фазе 0,
    // раньше первого узла графа, и зависеть от `Ctx(RequestId)` не может
    const wired = await wireApp(
      makeApp({
        transports: [
          transportValue(MockTransport$, new MockTransport(), {
            capabilities: VALUE_ONLY,
          }),
        ],
      }),
    );

    const { nodes } = await wired.container.toJSON();

    expect(nodes.filter((node) => node.id.startsWith('Ctx:'))).toEqual([]);

    await wired.close();
  });

  it('с подменённым корнем логгера в графе нет ни одного узла семейства Ctx', async () => {
    const probe = loggerProbe();
    const wired = await wireApp(
      makeApp({
        transports: [
          transportValue(MockTransport$, new MockTransport(), {
            capabilities: VALUE_ONLY,
          }),
        ],
        logger: probe.logger,
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
        transports: [
          transportValue(MockTransport$, new MockTransport(), {
            capabilities: VALUE_ONLY,
          }),
        ],
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
        transports: [
          transportValue(MockTransport$, new MockTransport(), {
            capabilities: VALUE_ONLY,
          }),
        ],
      }),
      {
        overrides: [[Ctx(RequestId), fake]],
      },
    );

    expect(wired.container.getOrThrow(DeepService).requestId).toBe(fake);

    await wired.close();
  });
});
