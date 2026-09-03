/**
 * Discovery: плоский проход по фичам и плагинам.
 *
 * Обхода дерева модулей здесь больше нет — endpoint'ы объявляет единица,
 * а список единиц плоский по построению.
 */

import { discoverEndpoints } from './discovery';
import { makeFeature, makePlugin } from './feature';

import { describe, expect, it } from '@jest/globals';
import { makeToken } from '@nestling/container';
import type { TransportRef } from '@nestling/pipeline';
import { makeEndpoint, Ok, transportNameOf } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

/** Токены транспортов фикстур: ссылка декларации — значение, а не строка */
const Http$ = makeToken('transport:http') as TransportRef;
const Cli$ = makeToken('transport:cli') as TransportRef;

/** Декларация-значение: единица discovery */
const endpoint = (transport: TransportRef, pattern: string) =>
  makeEndpoint({
    transport,
    pattern,
    handler: async () => new Ok({}),
  });

describe('discoverEndpoints', () => {
  it('несёт атрибуцию к объявившей единице', () => {
    const GetUser = httpEndpoint({
      method: 'GET',
      path: '/users/:id',
      input: z.object({ id: z.string() }),
      handler: async () => new Ok({}),
    });

    const Users = makeFeature({ name: 'users', endpoints: [GetUser] });

    const { endpoints } = discoverEndpoints([Users]);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({
      endpoint: GetUser,
      moduleName: 'users',
    });

    // Транспорт и паттерн читаются с самой декларации; транспорт — токен
    expect(transportNameOf(endpoints[0].endpoint.transport)).toBe('http');
    expect(endpoints[0].endpoint.pattern).toBe('GET /users/:id');
  });

  it("endpoint'ы плагина обнаруживаются наравне с фичевыми", () => {
    const Docs = endpoint(Http$, 'GET /openapi.json');
    const Ping = endpoint(Http$, 'GET /ping');

    const { endpoints } = discoverEndpoints([
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

    const { endpoints } = discoverEndpoints([
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

    const { endpoints } = discoverEndpoints([
      makeFeature({ name: 'users', endpoints: [Once, Once] }),
    ]);

    expect(endpoints).toHaveLength(1);
  });

  it('то же значение единицы, встреченное дважды, обходится один раз', () => {
    const Once = endpoint(Http$, 'GET /once');
    const Users = makeFeature({ name: 'users', endpoints: [Once] });

    expect(discoverEndpoints([Users, Users]).endpoints).toHaveLength(1);
  });

  it('две разные единицы под одним именем — ошибка', () => {
    const Left = makeFeature({ name: 'users', endpoints: [] });
    const Right = makeFeature({ name: 'users', endpoints: [] });

    expect(() => discoverEndpoints([Left, Right])).toThrow(
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

    const { transports } = discoverEndpoints([Mixed]);

    // Ключ карты — токен транспорта, а не его строковое имя
    expect(new Set(transports.keys())).toEqual(new Set([Cli$, Http$]));
    expect(transports.get(Http$)).toHaveLength(2);
    expect(transports.get(Cli$)).toHaveLength(1);
  });

  it('элемент endpoints: без бренда — ошибка с единицей и индексом', () => {
    class NotADeclaration {
      readonly kind = 'service';
    }

    expect(() =>
      discoverEndpoints([
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
    const discovery = discoverEndpoints([
      makeFeature({ name: 'users', endpoints: [endpoint(Http$, 'GET /x')] }),
    ]);

    expect(Object.isFrozen(discovery)).toBe(true);
    expect(Object.isFrozen(discovery.endpoints)).toBe(true);
    expect(() =>
      (discovery.transports as Map<TransportRef, never>).set(Cli$, [] as never),
    ).toThrow(/read-only/);
  });
});
