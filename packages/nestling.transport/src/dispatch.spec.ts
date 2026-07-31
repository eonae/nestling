/**
 * `makeDispatch`: обе ветки исполнения, состав проекции и границы контракта.
 *
 * Типовая часть проверяется здесь же (`@ts-expect-error`): `makeDispatch`
 * принимает только исполнимые декларации — симметрично тому, как pipeline
 * принимает только `Pipeline<_, _, never>`.
 */

import { makeDispatch } from './dispatch';

import { describe, expect, it } from '@jest/globals';
import { makeToken } from '@nestling/container';
import type { AnyInput, ExtendableContext } from '@nestling/pipeline';
import {
  makeEmptyContext,
  makeEndpoint,
  makePipeline,
  Ok,
} from '@nestling/pipeline';
import { z } from 'zod';

const TestTransport$ = makeToken('transport:test');

class UserService {
  getAll(): string[] {
    return ['ann'];
  }
}

/** Контекст, который построил бы транспорт после парсинга запроса */
const contextFor = (
  pattern: string,
  payload?: unknown,
): ExtendableContext<AnyInput> =>
  makeEmptyContext(
    { transport: 'test', pattern, payload, attributes: {} },
    { transport: 'test', pattern },
  );

describe('makeDispatch', () => {
  const Ping = makeEndpoint({
    transport: TestTransport$,
    pattern: 'GET /ping',
    output: z.object({ pong: z.boolean() }),
    pipeline: makePipeline(),
    handle: async () => new Ok({ pong: true }),
  });

  const Echo = makeEndpoint({
    transport: TestTransport$,
    pattern: 'POST /echo',
    input: z.object({ text: z.string() }),
    handle: async (payload: { text: string }) => new Ok(payload),
  });

  it('исполняет ручку с пайплайном', async () => {
    const dispatch = makeDispatch([Ping]);

    const response = await dispatch.call('GET /ping', contextFor('GET /ping'));

    expect(response).toMatchObject({ isSuccess: true, value: { pong: true } });
  });

  it('исполняет ручку без пайплайна, валидируя value-форму', async () => {
    const dispatch = makeDispatch([Echo]);

    const response = await dispatch.call(
      'POST /echo',
      contextFor('POST /echo', { text: 'hi' }),
    );

    expect(response).toMatchObject({ isSuccess: true, value: { text: 'hi' } });
  });

  it('невалидный вход ручки без пайплайна отвергается схемой', async () => {
    const dispatch = makeDispatch([Echo]);

    await expect(
      dispatch.call('POST /echo', contextFor('POST /echo', { text: 42 })),
    ).rejects.toThrow();
  });

  it('проекция маршрута не содержит исполнимых полей', () => {
    const { routes } = makeDispatch([Ping]);

    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      transport: TestTransport$,
      pattern: 'GET /ping',
    });
    expect('handle' in routes[0]).toBe(false);
    expect('pipeline' in routes[0]).toBe(false);
    expect('deps' in routes[0]).toBe(false);
    expect('resolve' in routes[0]).toBe(false);
  });

  it('неизвестный паттерн — ошибка с перечнем известных', async () => {
    const dispatch = makeDispatch([Ping]);

    await expect(
      dispatch.call('GET /nope', contextFor('GET /nope')),
    ).rejects.toThrow(/no route for pattern 'GET \/nope'.*GET \/ping/s);
  });

  it('две ручки с одним паттерном — ошибка при сборке диспетчера', () => {
    expect(() => makeDispatch([Ping, Ping])).toThrow(
      /already has a route for pattern 'GET \/ping'/,
    );
  });

  it('опции границы едут аргументом и доходят до стража', async () => {
    const Boom = makeEndpoint({
      transport: TestTransport$,
      pattern: 'GET /boom',
      pipeline: makePipeline(),
      handle: async () => {
        throw new Error('secret detail');
      },
    });

    const dispatch = makeDispatch([Boom]);
    const seen: string[] = [];

    const response = await dispatch.call('GET /boom', contextFor('GET /boom'), {
      exposeErrorDetails: true,
      onUnknownFail: (info) => seen.push(info.endpoint.pattern),
    });

    expect(response.isSuccess).toBe(false);
    expect(response.value).toMatchObject({ error: 'secret detail' });
    expect(seen).toEqual(['GET /boom']);
  });

  it('декларация с непогашенными зависимостями не проходит по типам', () => {
    const WithDeps = makeEndpoint({
      transport: TestTransport$,
      pattern: 'GET /users',
      pipeline: makePipeline(),
      deps: [UserService],
      handle: (users) => async () => new Ok(users.getAll()),
    });

    // @ts-expect-error: неразрешённые deps — сначала endpoint.resolve(...)
    makeDispatch([WithDeps]);

    // Гашение снимает ограничение
    const dispatch = makeDispatch([WithDeps.resolve([new UserService()])]);

    expect(dispatch.routes.map((route) => route.pattern)).toEqual([
      'GET /users',
    ]);
  });
});
