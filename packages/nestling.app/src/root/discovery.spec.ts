/**
 * Discovery: плоский проход по фичам и плагинам.
 *
 * Обхода дерева модулей здесь больше нет — endpoint'ы объявляет единица,
 * а список единиц плоский по построению.
 */

import type { TransportRef } from '../pipeline/index.js';
import { makeEndpoint, Ok, transportNameOf } from '../pipeline/index.js';

import { testEndpoint } from './__fixtures__/test-transport.js';
import { discoverEndpoints } from './discovery.js';
import type { Bundle, ResolvedBundle } from './feature.js';
import { makeFeature, makePlugin, resolveBundle } from './feature.js';

import { describe, expect, it } from '@jest/globals';
import { makeToken } from '@nestlingjs/container';
import { z } from 'zod';

/** DI-токены транспортов фикстур: ссылка декларации — значение, а не строка */
const Http$ = makeToken('transport:http') as TransportRef;
const Cli$ = makeToken('transport:cli') as TransportRef;

/** Декларация-значение: единица discovery */
const endpoint = (transport: TransportRef, pattern: string) =>
  makeEndpoint({
    transport,
    pattern,
    handler: async () => new Ok({}),
  });

/**
 * Discovery видит состав с раскрытыми ветками. Раскрытие запоминается:
 * функция сверяет единицы по идентичности значения.
 */
const cache = new Map<Bundle, ResolvedBundle>();

const discover = (bundles: readonly Bundle[]) =>
  discoverEndpoints(
    bundles.map((bundle) => {
      const known = cache.get(bundle);

      if (known) {
        return known;
      }

      const fresh = resolveBundle(bundle, {}, () => new Error('no switches'));
      cache.set(bundle, fresh);

      return fresh;
    }),
  );

describe('discoverEndpoints', () => {
  it('несёт атрибуцию к объявившей единице', () => {
    const GetUser = testEndpoint({
      method: 'GET',
      path: '/users/:id',
      input: z.object({ id: z.string() }),
      handler: async () => new Ok({}),
    });

    const Users = makeFeature({ name: 'users', endpoints: [GetUser] });

    const { endpoints } = discover([Users]);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({
      endpoint: GetUser,
      moduleName: 'users',
    });

    // Транспорт и паттерн читаются с самой декларации; транспорт — DI-токен
    expect(transportNameOf(endpoints[0].endpoint.transport)).toBe('test');
    expect(endpoints[0].endpoint.pattern).toBe('GET /users/:id');
  });

  it("endpoint'ы плагина обнаруживаются наравне с фичевыми", () => {
    const Docs = endpoint(Http$, 'GET /openapi.json');
    const Ping = endpoint(Http$, 'GET /ping');

    const { endpoints } = discover([
      makeFeature({ name: 'users', endpoints: [Ping] }),
      makePlugin({ name: '@acme/docs', endpoints: [Docs] }),
    ]);

    expect(endpoints.map(({ moduleName }) => moduleName)).toEqual([
      'users',
      '@acme/docs',
    ]);
  });

  it('порядок воспроизводим и следует порядку единиц', () => {
    const First = endpoint(Http$, 'GET /first');
    const Second = endpoint(Http$, 'GET /second');

    const { endpoints } = discover([
      makeFeature({ name: 'a', endpoints: [First] }),
      makeFeature({ name: 'b', endpoints: [Second] }),
    ]);

    expect(endpoints.map(({ endpoint: value }) => value.pattern)).toEqual([
      'GET /first',
      'GET /second',
    ]);
  });

  it('одна декларация, повторённая в единице, регистрируется один раз', () => {
    const Once = endpoint(Http$, 'GET /once');

    const { endpoints } = discover([
      makeFeature({ name: 'users', endpoints: [Once, Once] }),
    ]);

    expect(endpoints).toHaveLength(1);
  });

  it('то же значение единицы, встреченное дважды, обходится один раз', () => {
    const Once = endpoint(Http$, 'GET /once');
    const Users = makeFeature({ name: 'users', endpoints: [Once] });

    expect(discover([Users, Users]).endpoints).toHaveLength(1);
  });

  it('две разные единицы под одним именем — ошибка', () => {
    const Left = makeFeature({ name: 'users', endpoints: [] });
    const Right = makeFeature({ name: 'users', endpoints: [] });

    expect(() => discover([Left, Right])).toThrow(
      /Two different features are named 'users'/,
    );
  });

  it("группирует endpoint'ы по требуемому транспорту", () => {
    const Mixed = makeFeature({
      name: 'mixed',
      endpoints: [
        endpoint(Http$, 'GET /one'),
        endpoint(Http$, 'GET /two'),
        endpoint(Cli$, 'do-something'),
      ],
    });

    const { transports } = discover([Mixed]);

    // Ключ карты — DI-токен транспорта, а не его строковое имя
    expect(new Set(transports.keys())).toEqual(new Set([Cli$, Http$]));
    expect(transports.get(Http$)).toHaveLength(2);
    expect(transports.get(Cli$)).toHaveLength(1);
  });

  it('элемент endpoints: без бренда — ошибка с единицей и индексом', () => {
    class NotADeclaration {
      readonly kind = 'service';
    }

    expect(() =>
      discover([
        makeFeature({
          name: 'users',
          endpoints: [new NotADeclaration()] as never,
        }),
      ]),
    ).toThrow(
      /'endpoints:' of feature 'users' contains an instance of 'NotADeclaration' at index 0/,
    );
  });

  it('результат только для чтения: состав из графа не меняют', () => {
    const discovery = discover([
      makeFeature({ name: 'users', endpoints: [endpoint(Http$, 'GET /x')] }),
    ]);

    expect(Object.isFrozen(discovery)).toBe(true);
    expect(Object.isFrozen(discovery.endpoints)).toBe(true);
    expect(() =>
      (discovery.transports as Map<TransportRef, never>).set(Cli$, [] as never),
    ).toThrow(/read-only/);
  });
});
