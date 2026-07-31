/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Конструктор HTTP-деклараций: fail-fast транспортного словаря при
 * создании и типизация пути (`PathParams`).
 */

import { body, httpBindingOf, query } from './binding';
import type { PathParams } from './helpers';
import { httpEndpoint } from './helpers';
import { HttpTransport$ } from './token';

import { describe, expect, it } from '@jest/globals';
import {
  isEndpointDefinition,
  makePipeline,
  Ok,
  transportNameOf,
} from '@nestling/pipeline';
import { z } from 'zod';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const handle = async () => new Ok({});

describe('httpEndpoint', () => {
  it('собирает pattern из метода и пути и ставит бренд', () => {
    const CreateUser = httpEndpoint({
      method: 'POST',
      path: '/api/users',
      input: z.object({ name: z.string() }),
      handle: async (input) => new Ok({ name: input.name }),
    });

    // Ссылка на транспорт — токен; строковое имя выводится из его id
    expect(CreateUser.transport).toBe(HttpTransport$);
    expect(transportNameOf(CreateUser.transport)).toBe('http');
    expect(CreateUser.pattern).toBe('POST /api/users');
    expect(isEndpointDefinition(CreateUser)).toBe(true);
  });

  it('пустой path — ошибка в момент создания', () => {
    expect(() =>
      httpEndpoint({ method: 'GET', path: '' as string, handle }),
    ).toThrow(/'path' must be a non-empty string/);
  });

  it('path без ведущего слэша — ошибка в момент создания', () => {
    expect(() =>
      httpEndpoint({ method: 'GET', path: 'users', handle }),
    ).toThrow(/'path' must start with '\/', got 'users'/);
  });

  it('повторяющийся path-параметр — ошибка с именем параметра', () => {
    expect(() =>
      httpEndpoint({ method: 'GET', path: '/a/:id/b/:id', handle }),
    ).toThrow(/path parameter ':id' is declared twice/);
  });

  it('разные path-параметры в одном шаблоне легальны', () => {
    const GetOrder = httpEndpoint({
      method: 'GET',
      path: '/users/:id/orders/:orderId',
      input: z.object({ id: z.string(), orderId: z.string() }),
      handle,
    });

    expect(GetOrder.pattern).toBe('GET /users/:id/orders/:orderId');
  });
});

describe('PathParams', () => {
  it('выводит имена path-параметров из шаблона', () => {
    type TwoParams = PathParams<'/users/:id/orders/:orderId'>;
    type OneParam = PathParams<'/users/:id'>;
    type NoParams = PathParams<'/health'>;

    type _Two = Expect<Equal<TwoParams, 'id' | 'orderId'>>;
    type _One = Expect<Equal<OneParam, 'id'>>;
    type _None = Expect<Equal<NoParams, never>>;

    expect(true).toBe(true);
  });

  it('path остаётся литеральным типом декларации', () => {
    const GetUser = httpEndpoint({
      method: 'GET',
      path: '/users/:id',
      input: z.object({ id: z.string() }),
      handle,
    });

    // Литерал сохранён: из него построено правило «имя поля совпало с
    // path-параметром → путь»
    type _Pattern = Expect<Equal<typeof GetUser.pattern, string>>;

    expect(GetUser.pattern).toBe('GET /users/:id');
  });
});

describe('httpEndpoint — bind-карта на значении', () => {
  it('карта вычислена при создании и лежит на декларации', () => {
    const UpdateUser = httpEndpoint({
      method: 'PATCH',
      path: '/api/users/:id',
      input: z.object({
        id: z.string(),
        name: z.string().optional(),
        expand: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
      bind: { expand: query(), tags: query({ multiple: true }) },
      handle,
    });

    // Карта доступна из одного импорта декларации — без App и без сервера
    expect(httpBindingOf(UpdateUser)).toEqual({
      method: 'PATCH',
      path: '/api/users/:id',
      fields: {
        id: { in: 'path' },
        expand: { in: 'query' },
        tags: { in: 'query', multiple: true },
      },
      rest: 'body',
      rawBody: false,
    });
  });

  it('гашение зависимостей карту не теряет', () => {
    class UserService {
      get(id: string) {
        return { id };
      }
    }

    const GetUser = httpEndpoint({
      method: 'GET',
      path: '/api/users/:id',
      input: z.object({ id: z.string() }),
      deps: [UserService],
      handle:
        (users) =>
        async ({ id }) =>
          new Ok(users.get(id)),
    });

    const resolved = GetUser.resolve([new UserService()]);

    expect(httpBindingOf(resolved)).toEqual(httpBindingOf(GetUser));
  });

  it('нарушение правила размещения — ошибка в момент создания', () => {
    expect(() =>
      httpEndpoint({
        method: 'GET',
        path: '/api/users',
        input: z.object({ filter: z.string() }),
        // По типам легально (место с методом не сверяется) — правило
        // проверяется в рантайме, при создании значения
        bind: { filter: body() },
        handle,
      }),
    ).toThrow(/'filter' is bound to the body, but 'GET' has no request body/);
  });
});

// ============================================================================
// Типовые тесты словаря
// ============================================================================

describe('httpEndpoint — типы bind и rawBody', () => {
  const UpdateUserInput = z.object({
    id: z.string(),
    name: z.string().optional(),
    expand: z.string().optional(),
  });

  it('неизвестное поле в bind не компилируется', () => {
    httpEndpoint({
      method: 'PATCH',
      path: '/users/:id',
      input: UpdateUserInput,
      // @ts-expect-error: поля 'expnd' в схеме нет
      bind: { expnd: query() },
      handle,
    });

    expect(true).toBe(true);
  });

  it('пометка на path-параметре не компилируется (и падает в рантайме)', () => {
    expect(() =>
      httpEndpoint({
        method: 'PATCH',
        path: '/users/:id',
        input: UpdateUserInput,
        // @ts-expect-error: 'id' — path-параметр шаблона, перебиндить нельзя
        bind: { id: query() },
        handle,
      }),
    ).toThrow(/'id' is the path parameter ':id'/);
  });

  it('известное поле в bind компилируется', () => {
    const Ok200 = httpEndpoint({
      method: 'PATCH',
      path: '/users/:id',
      input: UpdateUserInput,
      bind: { expand: query() },
      handle,
    });

    expect(Ok200.pattern).toBe('PATCH /users/:id');
  });

  it('pipeline с требованием rawBody без пометки не компилируется', () => {
    httpEndpoint({
      method: 'POST',
      path: '/hooks/stripe',
      input: z.object({ id: z.string() }),
      // @ts-expect-error: { __error; missing: { rawBody: Uint8Array }; hint }
      // — слой требует { rawBody }, а 'rawBody: true' не объявлен.
      // Текст диагностики зафиксирован снапшотом:
      // packages/nestling.pipeline/type-tests/fixtures/endpoint-missing-rawbody.ts
      pipeline: makePipeline<{ rawBody: Uint8Array }>(),
      handle,
    });

    expect(true).toBe(true);
  });

  it('он же с rawBody: true компилируется', () => {
    const Hook = httpEndpoint({
      method: 'POST',
      path: '/hooks/stripe',
      input: z.object({ id: z.string() }),
      rawBody: true,
      pipeline: makePipeline<{ rawBody: Uint8Array }>(),
      handle,
    });

    expect(httpBindingOf(Hook).rawBody).toBe(true);
  });

  it('обычный pipeline остаётся совместим с любым словарём', () => {
    const WithRawBody = httpEndpoint({
      method: 'POST',
      path: '/hooks/plain',
      input: z.object({ id: z.string() }),
      rawBody: true,
      pipeline: makePipeline(),
      handle,
    });

    const WithoutRawBody = httpEndpoint({
      method: 'POST',
      path: '/plain',
      input: z.object({ id: z.string() }),
      pipeline: makePipeline(),
      handle,
    });

    expect(httpBindingOf(WithRawBody).rawBody).toBe(true);
    expect(httpBindingOf(WithoutRawBody).rawBody).toBe(false);
  });

  it('detached доезжает до значения декларации, пустая причина отвергается', () => {
    const reason = 'liveness-проба балансировщика: до auth не доходит';

    const Health = httpEndpoint({
      method: 'GET',
      path: '/health',
      detached: reason,
      handle,
    });

    expect(Health.detached).toBe(reason);

    // Текст — тот же, что у kernel-примитива: транспорт причину не
    // интерпретирует и своей проверки не заводит
    expect(() =>
      httpEndpoint({ method: 'GET', path: '/health', detached: '  ', handle }),
    ).toThrow(/'detached' must state a reason/);
  });

  it('непрозрачный input деградирует до отсутствия подсказок, а не до ошибки', () => {
    // Схемы нет — ключей не вывести; `bind` принимает любые имена, правила
    // остаются за рантаймом
    const Opaque = httpEndpoint({
      method: 'POST',
      path: '/opaque',
      input: 'text',
      handle,
    });

    expect(Opaque.pattern).toBe('POST /opaque');
  });
});
