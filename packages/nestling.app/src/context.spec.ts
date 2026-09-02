/**
 * Kernel-модуль ambient-контекста в корне.
 *
 * Предмет проверки — цена «всегда»: модуль регистрируется безусловно, но
 * без единого `Ctx(...)` в `deps` не даёт ни одного узла, а с ним — даёт
 * обычный узел графа, видимый в сериализации и подменяемый штатным
 * `valueProvider`.
 */

import { makeFeature } from './feature';
import { wireApp } from './testing/index.js';
import { MockTransport } from './helpers';

import { describe, expect, it } from '@jest/globals';
import { Injectable, valueProvider } from '@nestling/container';
import type { CtxReader } from '@nestling/pipeline';
import { Ctx, RequestId } from '@nestling/pipeline';

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
    const wired = await wireApp({
      features: [DeepModule],
      transports: [valueProvider(MockTransport, new MockTransport())],
    });

    const service = wired.container.getOrThrow(DeepService);

    expect(service.requestId.peek()).toBeUndefined();

    await wired.close();
  });

  it('без читателей в графе нет ни одного узла семейства Ctx', async () => {
    const wired = await wireApp({
      transports: [valueProvider(MockTransport, new MockTransport())],
    });

    const { nodes } = await wired.container.toJSON();

    expect(nodes.filter((node) => node.id.startsWith('Ctx:'))).toEqual([]);

    await wired.close();
  });

  it('узел ридера присутствует в сериализации графа', async () => {
    const wired = await wireApp({
      features: [DeepModule],
      transports: [valueProvider(MockTransport, new MockTransport())],
    });

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

    const wired = await wireApp({
      features: [DeepModule],
      transports: [valueProvider(MockTransport, new MockTransport())],
      overrides: [[Ctx(RequestId), fake]],
    });

    expect(wired.container.getOrThrow(DeepService).requestId).toBe(fake);

    await wired.close();
  });
});
