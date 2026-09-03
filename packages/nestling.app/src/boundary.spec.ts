/* eslint-disable @typescript-eslint/no-empty-function --
 * Сервисы-фикстуры ничего не делают: тест смотрит на рёбра графа, а не на
 * поведение узлов. */
/**
 * Граница фичи: карта «модуль → владелец» и проверка рёбер собранного
 * графа.
 *
 * Правило одно: к фиче обращаются операциями, к плагину — токенами.
 * Проверяется оно на графе, поэтому и тесты идут через сборку, а не через
 * значения деклараций.
 */

import { makeApp } from './app';
import { buildOwnerMap } from './boundary';
import { makeFeature, makePlugin } from './feature';
import { MockTransport } from './helpers';

import { describe, expect, it } from '@jest/globals';
import { Injectable, makeToken } from '@nestling/container';
import { makeRequest } from '@nestling/operations';
import { Ok } from '@nestling/pipeline';
import type { Port } from '@nestling/ports';
import { implement } from '@nestling/ports';
import { transportValue } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

const asHttp = () =>
  transportValue(HttpTransport$('default'), new MockTransport());

@Injectable([])
class QuotaService {
  claim(): number {
    return 1;
  }
}

/** Потребитель чужого сервиса: ребро, которое не переживёт разъезда */
@Injectable([QuotaService])
class UserService {
  constructor(readonly quotas: QuotaService) {}
}

@Injectable([])
class Logger {
  log(): void {}
}

const anyEndpoint = (path: string, deps: readonly unknown[] = []) =>
  httpEndpoint({
    method: 'GET',
    path,
    handler: {
      deps: deps as never,
      handle:
        (...injected: unknown[]) =>
        async () =>
          new Ok({ injected: injected.length }),
    },
  });

describe('карта «модуль → владелец»', () => {
  it('плагин владеет модулем, достижимым и из фичи', () => {
    const Shared = { name: 'shared', providers: [Logger] };
    const Infra = makePlugin({ name: '@acme/logging', modules: [Shared] });
    const Users = makeFeature({ name: 'users', modules: [Shared] });

    const owners = buildOwnerMap([Users], [Infra]);

    expect(owners.get('shared')).toEqual({
      name: '@acme/logging',
      role: 'plugin',
    });
  });

  it('модуль, достижимый по dependsOn, получает владельца единицы', () => {
    const Core = { name: 'users-core', providers: [QuotaService] };
    const Api = { name: 'users-api', dependsOn: [Core] };
    const Users = makeFeature({ name: 'users', modules: [Api] });

    const owners = buildOwnerMap([Users], []);

    expect(owners.get('users-core')).toEqual({
      name: 'users',
      role: 'feature',
    });
  });
});

describe('фичи связаны только операциями', () => {
  it('прямой инжект чужого сервиса роняет сборку', async () => {
    const Quotas = makeFeature({ name: 'quotas', providers: [QuotaService] });
    const Users = makeFeature({
      name: 'users',
      providers: [UserService],
      endpoints: [anyEndpoint('/users', [UserService])],
    });

    const app = makeApp({
      features: [Quotas, Users],
      transports: [asHttp()],
    });

    await expect(app.check()).rejects.toThrow(
      /Feature 'users' depends on feature 'quotas' by token/,
    );
  });

  it('ошибка называет обе фичи, токен и замену вызовом операции', async () => {
    const Quotas = makeFeature({ name: 'quotas', providers: [QuotaService] });
    const Users = makeFeature({
      name: 'users',
      providers: [UserService],
      endpoints: [anyEndpoint('/users', [UserService])],
    });

    const failure = await makeApp({
      features: [Quotas, Users],
      transports: [asHttp()],
    })
      .check()
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);

    const { message } = failure as Error;

    expect(message).toContain('UserService');
    expect(message).toContain('QuotaService');
    expect(message).toContain('makeRequest');
  });

  it('обращение к плагину разрешено', async () => {
    const Infra = makePlugin({ name: '@acme/logging', providers: [Logger] });

    @Injectable([Logger])
    class Greeter {
      constructor(readonly logger: Logger) {}
    }

    const Users = makeFeature({
      name: 'users',
      providers: [Greeter],
      endpoints: [anyEndpoint('/users', [Greeter])],
    });

    const app = makeApp({
      features: [Users],
      plugins: [Infra],
      transports: [asHttp()],
    });

    await expect(app.check()).resolves.toBeDefined();
  });

  it('ребро внутри своей фичи разрешено', async () => {
    const Users = makeFeature({
      name: 'users',
      providers: [QuotaService, UserService],
      endpoints: [anyEndpoint('/users', [UserService])],
    });

    const app = makeApp({
      features: [Users],
      transports: [asHttp()],
    });

    await expect(app.check()).resolves.toBeDefined();
  });

  it('вызов операции соседней фичи границу не нарушает', async () => {
    const ClaimQuota = makeRequest({
      name: 'boundary.quotas.claim',
      input: z.object({ amount: z.number() }),
      output: z.object({ granted: z.number() }),
    });

    const Quotas = makeFeature({
      name: 'quotas',
      endpoints: [
        implement(ClaimQuota, { handler: async () => new Ok({ granted: 1 }) }),
      ],
    });

    const Users = makeFeature({
      name: 'users',
      endpoints: [
        httpEndpoint({
          method: 'POST',
          path: '/orders',
          handler: {
            deps: [ClaimQuota.caller],
            handle: (quotas: Port<typeof ClaimQuota>) => async () => {
              await quotas.call({ amount: 1 });

              return new Ok({});
            },
          },
        }),
      ],
    });

    const app = makeApp({
      features: [Quotas, Users],
      transports: [asHttp()],
    });

    await expect(app.check()).resolves.toBeDefined();
  });
});

describe('плагин не зависит от фичи', () => {
  it('инжект сервиса фичи из плагина роняет сборку', async () => {
    const Users = makeFeature({ name: 'users', providers: [QuotaService] });
    const Infra = makePlugin({
      name: '@acme/reporting',
      providers: [UserService],
      endpoints: [anyEndpoint('/report', [UserService])],
    });

    const app = makeApp({
      features: [Users],
      plugins: [Infra],
      transports: [asHttp()],
    });

    await expect(app.check()).rejects.toThrow(
      /Plugin '@acme\/reporting' depends on feature 'users'/,
    );
  });

  it('данные приложения, пришедшие параметром, ребра не создают', async () => {
    const ServiceName$ = makeToken<string>('ServiceName');

    const logging = (service: string) =>
      makePlugin({
        name: '@acme/logging',
        providers: [{ provide: ServiceName$, useValue: service }],
      });

    const Users = makeFeature({
      name: 'users',
      providers: [QuotaService],
      endpoints: [anyEndpoint('/users', [QuotaService])],
    });

    const app = makeApp({
      features: [Users],
      plugins: [logging('orders-api')],
      transports: [asHttp()],
    });

    await expect(app.check()).resolves.toBeDefined();
  });
});

describe('общий модуль обязан быть плагином', () => {
  it('модуль в составе двух фич роняет сборку', async () => {
    const Shared = { name: 'shared', providers: [QuotaService] };
    const Users = makeFeature({ name: 'users', modules: [Shared] });
    const Orders = makeFeature({ name: 'orders', modules: [Shared] });

    const app = makeApp({
      features: [Users, Orders],
      transports: [asHttp()],
    });

    await expect(app.check()).rejects.toThrow(
      /Module 'shared' is reachable from two features/,
    );
  });

  it('ошибка предлагает объявить его плагином', () => {
    const Shared = { name: 'shared', providers: [QuotaService] };
    const Users = makeFeature({ name: 'users', modules: [Shared] });
    const Orders = makeFeature({ name: 'orders', modules: [Shared] });

    expect(() => buildOwnerMap([Users, Orders], [])).toThrow(
      /declare it with makePlugin and list it in 'plugins:'/,
    );
  });

  it('тот же модуль, объявленный плагином, сборку не ломает', async () => {
    const Shared = { name: 'shared', providers: [QuotaService] };
    const Infra = makePlugin({ name: '@acme/shared', modules: [Shared] });

    const Users = makeFeature({
      name: 'users',
      endpoints: [anyEndpoint('/users', [QuotaService])],
    });
    const Orders = makeFeature({
      name: 'orders',
      endpoints: [anyEndpoint('/orders', [QuotaService])],
    });

    const app = makeApp({
      features: [Users, Orders],
      plugins: [Infra],
      transports: [asHttp()],
    });

    await expect(app.check()).resolves.toBeDefined();
  });
});
