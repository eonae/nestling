/**
 * Инжектируемая discovery: состав приложения как узел графа.
 *
 * Предмет проверки — три обещания DI-токена: значение то же самое, что
 * вычислил `App` (а не второй обход дерева), оно описывает **выбранную**
 * топологию, и менять состав приложения через него нельзя.
 */

import { Ok } from '../pipeline/index.js';
import type { ITransport } from '../transport/index.js';
import { transportValue } from '../transport/index.js';

import {
  testEndpoint,
  TestTransport$,
  VALUE_ONLY,
} from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import type { EndpointDiscovery } from './discovery.js';
import { Discovery$ } from './discovery.js';
import { makeFeature } from './feature.js';
import { MockTransport } from './helpers.js';

import { beforeEach, describe, expect, it } from '@jest/globals';
import { factoryProvider, makeToken } from '@nestlingjs/container';

const asTransport = (transport: ITransport) =>
  transportValue(TestTransport$('default'), transport, {
    capabilities: VALUE_ONLY,
  });

/**
 * Что увидел модуль-наблюдатель последней сборки.
 *
 * Побочный эффект в фабрике — приём теста, а не образец: другого способа
 * достать значение из собранного графа наружу у публичной поверхности `App`
 * нет, и заводить его ради теста не стоит.
 */
let seen: EndpointDiscovery | undefined;

const Observer$ = makeToken<'observed'>('spec:discovery-observer');

const observer = factoryProvider(
  Observer$,
  (discovery: EndpointDiscovery) => {
    seen = discovery;
    return 'observed' as const;
  },
  [Discovery$],
);

const ListUsers = testEndpoint({
  method: 'GET',
  path: '/users',
  handler: async () => new Ok({ users: [] }),
});

const ListInvoices = testEndpoint({
  method: 'GET',
  path: '/invoices',
  handler: async () => new Ok({ invoices: [] }),
});

const UsersFeature = makeFeature({
  name: 'discovery-users',
  providers: [observer],
  endpoints: [ListUsers],
});

const BillingFeature = makeFeature({
  name: 'discovery-billing',
  endpoints: [ListInvoices],
});

const patternsOf = (discovery: EndpointDiscovery): string[] =>
  discovery.endpoints.map(({ endpoint }) => endpoint.pattern).sort();

function observed(): EndpointDiscovery {
  if (!seen) {
    throw new Error('Discovery$ was never injected');
  }
  return seen;
}

beforeEach(() => {
  seen = undefined;
});

describe('Discovery$ — состав приложения на входе графа', () => {
  it("провайдер получает endpoint'ы с их атрибуцией к единицам", async () => {
    const app = makeApp({
      features: [UsersFeature],
      transports: [asTransport(new MockTransport())],
    }).assemble();

    await app.run();

    expect(observed().endpoints).toEqual([
      { endpoint: ListUsers, moduleName: 'discovery-users' },
    ]);

    await app.close();
  });

  it('инжектировано то же значение, с которым App начал принимать запросы', async () => {
    const transport = new MockTransport();
    const app = makeApp({
      features: [UsersFeature, BillingFeature],
      transports: [asTransport(transport)],
    }).assemble();

    await app.run();

    // «Обнаруженное» и «обслуживаемое» совпадают всегда: discovery
    // считается один раз за сборку
    expect(patternsOf(observed())).toEqual(
      [...transport.routes].map((route) => route.pattern).sort(),
    );

    await app.close();
  });

  it('невыбранная фича в значении отсутствует', async () => {
    const app = makeApp({
      features: [UsersFeature, BillingFeature],
      transports: [asTransport(new MockTransport())],
    }).assemble('discovery-users');

    await app.run();

    expect(patternsOf(observed())).toEqual(['GET /users']);

    await app.close();
  });

  it('выбор всех фич отражён в значении целиком', async () => {
    const app = makeApp({
      features: [UsersFeature, BillingFeature],
      transports: [asTransport(new MockTransport())],
    }).assemble('all');

    await app.run();

    expect(patternsOf(observed())).toEqual(['GET /invoices', 'GET /users']);

    await app.close();
  });

  it('состав приложения через значение изменить нельзя', async () => {
    const app = makeApp({
      features: [UsersFeature],
      transports: [asTransport(new MockTransport())],
    }).assemble();

    await app.run();
    const discovery = observed();

    expect(() =>
      (discovery.endpoints as unknown as unknown[]).push({} as never),
    ).toThrow(TypeError);

    expect(() =>
      (discovery.transports as unknown as Map<unknown, unknown>).set(
        TestTransport$,
        [],
      ),
    ).toThrow(/read-only/);

    expect(patternsOf(discovery)).toEqual(['GET /users']);

    await app.close();
  });

  it('check() не создаёт экземпляров — наблюдатель Discovery$ не срабатывает', async () => {
    const app = makeApp({
      features: [UsersFeature],
      transports: [asTransport(new MockTransport())],
    });

    // `check()` — это фазы 0–1: ни один провайдер, включая фабрику-
    // наблюдателя, не строится. Отчёт складывается из того же discovery,
    // но инжекции, которая его вернула бы наружу, не происходит
    const report = await app.check();

    expect(() => observed()).toThrow('Discovery$ was never injected');
    expect(report.endpoints.map(({ pattern }) => pattern)).toEqual([
      'GET /users',
    ]);
  });
});
