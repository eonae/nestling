/**
 * `makeDispatch`: обе ветки исполнения, состав проекции и границы контракта.
 *
 * Типовая часть проверяется здесь же (`@ts-expect-error`): `makeDispatch`
 * принимает только исполнимые декларации — симметрично тому, как pipeline
 * принимает только `Pipeline<_, _, never>`.
 */

import { makeDispatch } from './dispatch';

import { describe, expect, it } from '@jest/globals';
import { ContainerBuilder, makeToken } from '@nestling/container';
import type {
  AnyInput,
  CtxReader,
  ExtendableContext,
} from '@nestling/pipeline';
import {
  contextKernel,
  Ctx,
  makeEmptyContext,
  makeEndpoint,
  makePipeline,
  Ok,
  RequestId,
  Signal,
} from '@nestling/pipeline';
import { z } from 'zod';

const TestTransport$ = makeToken('transport:test');

/**
 * Ридеры из настоящего графа: kernel-модуль контекста регистрируется
 * корнем, поэтому и в тесте они приезжают тем же путём, а не фейком.
 */
async function contextReaders(): Promise<{
  requestId: CtxReader<string>;
  signal: CtxReader<AbortSignal>;
}> {
  const builder = new ContainerBuilder();
  builder.register(contextKernel());
  builder.register({
    provide: makeToken('probe'),
    useFactory: (...args: unknown[]) => args,
    deps: [Ctx(RequestId), Ctx(Signal)],
  });

  const container = await builder.build();

  return {
    requestId: container.getOrThrow(Ctx(RequestId)),
    signal: container.getOrThrow(Ctx(Signal)),
  };
}

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

  it('ручка без пайплайна исполняется под тем же scope запроса', async () => {
    const controller = new AbortController();
    const seen: { requestId?: string; sameSignal?: boolean } = {};

    const Probe = makeEndpoint({
      transport: TestTransport$,
      pattern: 'GET /probe',
      deps: [Ctx(RequestId), Ctx(Signal)],
      handle:
        (requestId: CtxReader<string>, signal: CtxReader<AbortSignal>) =>
        async () => {
          // Пайплайна нет — переменную никто не клал; но контекст запроса
          // открыт, поэтому это `undefined`, а не «контекста нет»
          seen.requestId = requestId.peek();
          seen.sameSignal = signal.get() === controller.signal;

          return new Ok({ ok: true });
        },
    });

    const readers = await contextReaders();
    const dispatch = makeDispatch([
      Probe.resolve([readers.requestId, readers.signal]),
    ]);

    const ctx = makeEmptyContext(
      {
        transport: 'test',
        pattern: 'GET /probe',
        payload: undefined,
        attributes: {},
      },
      { transport: 'test', pattern: 'GET /probe' },
      controller.signal,
    );

    const response = await dispatch.call('GET /probe', ctx);

    expect(response).toMatchObject({ isSuccess: true });
    expect(seen).toEqual({ requestId: undefined, sameSignal: true });
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
