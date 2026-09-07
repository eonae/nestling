/**
 * Уникальность пары «экземпляр транспорта, паттерн»: дубликат — ошибка
 * фазы ASSEMBLE, до создания экземпляров и захвата ресурсов.
 */

import { Ok } from '../pipeline/index.js';
import { implement } from '../ports/index.js';
import { transportValue } from '../transport/index.js';

import {
  ALL_FORMS,
  testEndpoint,
  TestTransport$,
} from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { discoverEndpoints } from './discovery.js';
import type { Bundle } from './feature.js';
import { makeFeature, resolveBundle } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import { Resource } from '@nestling/container';
import { makeEvent, makeRequest } from '@nestling/operations';
import { z } from 'zod';

/** Discovery видит состав с раскрытыми ветками: единицы приходят к ней резолвнутыми */
const discover = (bundles: readonly Bundle[]) =>
  discoverEndpoints(
    bundles.map((bundle) =>
      resolveBundle(bundle, {}, () => new Error('no switches')),
    ),
  );

/** Декларация с заданным паттерном и экземпляром транспорта */
const ping = (method: string, path: string, on?: string) =>
  testEndpoint({
    method,
    path,
    ...(on === undefined ? {} : { on }),
    output: z.object({ pong: z.boolean() }),
    handler: async () => new Ok({ pong: true }),
  });

describe('discovery — паттерн уникален внутри экземпляра', () => {
  it('две единицы объявили один паттерн — ошибка с обеими', () => {
    const users = makeFeature({
      name: 'users',
      endpoints: [ping('GET', '/users')],
    });
    const admin = makeFeature({
      name: 'admin',
      endpoints: [ping('GET', '/users')],
    });

    expect(() => discover([users, admin])).toThrow(
      /'GET \/users' on transport 'test', declared in 'users', 'admin'/,
    );
  });

  it('один паттерн на разных экземплярах проходит', () => {
    const users = makeFeature({
      name: 'users',
      endpoints: [ping('GET', '/health')],
    });
    const ops = makeFeature({
      name: 'ops',
      endpoints: [ping('GET', '/health', 'admin')],
    });

    expect(() => discover([users, ops])).not.toThrow();
  });

  it('метод входит в паттерн', () => {
    const users = makeFeature({
      name: 'users',
      endpoints: [ping('GET', '/users'), ping('POST', '/users')],
    });

    expect(() => discover([users])).not.toThrow();
  });

  it('несколько дубликатов перечисляются одной ошибкой', () => {
    const users = makeFeature({
      name: 'users',
      endpoints: [ping('GET', '/users'), ping('GET', '/quotas')],
    });
    const admin = makeFeature({
      name: 'admin',
      endpoints: [ping('GET', '/users'), ping('GET', '/quotas')],
    });

    let message = '';
    try {
      discover([users, admin]);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/2 pattern\(s\) declared more than once/);
    expect(message).toMatch(/'GET \/users'/);
    expect(message).toMatch(/'GET \/quotas'/);
  });
});

describe('дубликат падает до захвата ресурсов', () => {
  it('`acquire` не вызывается ни разу', async () => {
    const acquired: string[] = [];

    @Resource([])
    class Pool {
      static async acquire(): Promise<Pool> {
        acquired.push('pool');

        return new Pool();
      }

      async release(): Promise<void> {
        acquired.push('release');
      }
    }

    const users = makeFeature({
      name: 'users',
      endpoints: [ping('GET', '/users')],
      providers: [Pool],
    });
    const admin = makeFeature({
      name: 'admin',
      endpoints: [ping('GET', '/users')],
    });

    const app = makeApp({
      features: [users, admin],
      transports: [
        transportValue(TestTransport$('default'), new MockTransport(), {
          capabilities: ALL_FORMS,
        }),
      ],
    }).assemble();

    await expect(app.run()).rejects.toThrow(/declared more than once/);
    expect(acquired).toEqual([]);

    await app.close();
  });
});

describe('правило шины остаётся отдельным', () => {
  it('два владельца операции — ошибка топологии, а не паттерна', () => {
    const Charge = makeRequest({
      name: 'uniqueness.billing.charge',
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const implementation = () =>
      implement(Charge, { handler: async () => new Ok({ ok: true }) });

    const first = makeFeature({
      name: 'billing',
      endpoints: [implementation()],
    });
    const second = makeFeature({
      name: 'billing-copy',
      endpoints: [implementation()],
    });

    // Discovery про операции ничего не говорит: их владельца проверяет
    // топология операций, своим текстом ошибки
    expect(() => discover([first, second])).not.toThrow();
  });

  it('у события несколько подписчиков на один subject', () => {
    const Signed = makeEvent({
      name: 'uniqueness.users.signed-up',
      input: z.object({ id: z.string() }),
    });

    const audit = makeFeature({
      name: 'audit',
      endpoints: [
        implement(Signed, {
          subscriber: 'audit',
          handler: async () => new Ok(undefined),
        }),
      ],
    });
    const mailer = makeFeature({
      name: 'mailer',
      endpoints: [
        implement(Signed, {
          subscriber: 'mailer',
          handler: async () => new Ok(undefined),
        }),
      ],
    });

    expect(() => discover([audit, mailer])).not.toThrow();
  });
});
