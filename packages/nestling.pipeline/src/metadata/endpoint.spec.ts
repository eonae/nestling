/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable unicorn/consistent-function-scoping, unicorn/no-useless-undefined */
/**
 * Декларация endpoint'а — значение: рантайм трёх форм `handle`, гашение
 * зависимостей и бренд; плюс типовые тесты на `TNeeds`.
 */

import { Ok } from '../core';
import { makePipeline } from '../core/pipeline';

import type { EndpointDefinition } from './endpoint';
import { isEndpointDefinition, makeEndpoint } from './endpoint';

import { describe, expect, it, jest } from '@jest/globals';
import type { TokenString } from '@nestling/container';
import { makeToken } from '@nestling/container';
import { z } from 'zod';

// ============================================================================
// Утилиты для типовых проверок
// ============================================================================

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

type InferNeeds<D> =
  D extends EndpointDefinition<any, any, any, infer N> ? N : never;

// ============================================================================
// Фикстуры
// ============================================================================

interface ILoggerService {
  log(message: string): void;
}

const ILogger = makeToken<ILoggerService>('ILogger');

class UserService {
  getById(id: string) {
    return { id, name: 'Alice' };
  }
}

const UserInput = z.object({ id: z.string() });
const UserOutput = z.object({ id: z.string(), name: z.string() });

const meta = { signal: new AbortController().signal };

// ============================================================================
// Рантайм
// ============================================================================

describe('makeEndpoint — формы handle', () => {
  it('голая функция исполнима сразу, без гашения', async () => {
    const Ping = makeEndpoint({
      transport: 'http',
      pattern: 'GET /ping',
      handle: async () => new Ok({ pong: true }),
    });

    await expect(Ping.handle(undefined, meta)).resolves.toEqual(
      new Ok({ pong: true }),
    );
  });

  it('каррированная фабрика исполняется после resolve', async () => {
    const GetUser = makeEndpoint({
      transport: 'http',
      pattern: 'GET /users/:id',
      input: UserInput,
      output: UserOutput,
      deps: [UserService],
      handle: (users) => async (input) => new Ok(users.getById(input.id)),
    });

    const resolved = GetUser.resolve([new UserService()]);

    await expect(resolved.handle({ id: '7' }, meta)).resolves.toEqual(
      new Ok({ id: '7', name: 'Alice' }),
    );
  });

  it('класс-хендлер резолвится резолвером и сохраняет this', async () => {
    class GetUserHandler {
      constructor(private readonly users: UserService) {}

      async handle(input: { id: string }) {
        return new Ok(this.users.getById(input.id));
      }
    }

    const GetUser = makeEndpoint({
      transport: 'http',
      pattern: 'GET /users/:id',
      input: UserInput,
      output: UserOutput,
      handle: GetUserHandler,
    });

    const instance = new GetUserHandler(new UserService());
    const resolved = GetUser.resolve(() => instance);

    await expect(resolved.handle({ id: '1' }, meta)).resolves.toEqual(
      new Ok({ id: '1', name: 'Alice' }),
    );
  });

  it('до гашения handle бросает понятную ошибку, а не отдаёт undefined', () => {
    const GetUser = makeEndpoint({
      transport: 'http',
      pattern: 'GET /users/:id',
      deps: [UserService],
      handle: (users) => async () => new Ok(users.getById('1')),
    });

    expect(() => GetUser.handle(undefined, meta)).toThrow(
      /GET \/users\/:id.*unresolved dependencies/s,
    );
  });

  it('внешний вызов фабрики — один раз на несколько запросов', async () => {
    const factory = jest.fn((users: UserService) => async () => new Ok({}));

    const Endpoint = makeEndpoint({
      transport: 'http',
      pattern: 'GET /counted',
      deps: [UserService],
      handle: factory,
    });

    const resolved = Endpoint.resolve([new UserService()]);

    await resolved.handle(undefined, meta);
    await resolved.handle(undefined, meta);
    await resolved.handle(undefined, meta);

    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe('makeEndpoint — resolve', () => {
  const declaration = makeEndpoint({
    transport: 'http',
    pattern: 'GET /users/:id',
    input: UserInput,
    deps: [UserService],
    handle: (users) => async (input: { id: string }) =>
      new Ok(users.getById(input.id)),
  });

  it('возвращает новое значение, исходную декларацию не трогает', async () => {
    const first = declaration.resolve([new UserService()]);
    const second = declaration.resolve([new UserService()]);

    expect(first).not.toBe(declaration);
    expect(first).not.toBe(second);

    // Исходная по-прежнему не исполнима
    expect(() => declaration.handle({ id: '1' }, meta)).toThrow(
      /unresolved dependencies/,
    );
    await expect(first.handle({ id: '1' }, meta)).resolves.toBeInstanceOf(Ok);
    await expect(second.handle({ id: '1' }, meta)).resolves.toBeInstanceOf(Ok);
  });

  it('резолвер, не отдавший зависимость, — ошибка с именем токена', () => {
    const NeedsLogger = makeEndpoint({
      transport: 'http',
      pattern: 'GET /logged',
      deps: [ILogger],
      handle: (logger) => async () => {
        logger.log('served');
        return new Ok({});
      },
    });

    expect(() => NeedsLogger.resolve(() => undefined)).toThrow(
      /ILogger.*not provided by the resolver/s,
    );
  });

  it('позиционная форма сверяет число инстансов с deps', () => {
    expect(() => declaration.resolve([])).toThrow(
      /got 0 instance\(s\) for 1 declared/,
    );
  });

  it('класс-хендлер требует резолвер-формы', () => {
    class Handler {
      async handle() {
        return new Ok({});
      }
    }

    const WithClass = makeEndpoint({
      transport: 'http',
      pattern: 'GET /class',
      handle: Handler,
    });

    expect(() => WithClass.resolve([new Handler()])).toThrow(
      /class handler 'Handler'.*resolve\(resolver\)/s,
    );
  });

  it('связывает классы-юниты пайплайна тем же резолвером', async () => {
    class WithTracing {
      handle(): { traceId: string } {
        return { traceId: 'trace' };
      }
    }

    const Traced = makeEndpoint({
      transport: 'http',
      pattern: 'GET /traced',
      pipeline: makePipeline().pre(WithTracing),
      handle: async () => new Ok({}),
    });

    const resolved = Traced.resolve(() => new WithTracing());

    // Пайплайн стал исполнимым: bind прошёл на тех же зависимостях
    expect(resolved.pipeline).toBeDefined();
    expect(resolved.pipeline).not.toBe(Traced.pipeline);
  });

  it('пайплайн с классами-юнитами недоступен позиционной форме', () => {
    class WithTracing {
      handle(): { traceId: string } {
        return { traceId: 'trace' };
      }
    }

    const Traced = makeEndpoint({
      transport: 'http',
      pattern: 'GET /traced',
      pipeline: makePipeline().pre(WithTracing),
      handle: async () => new Ok({}),
    });

    expect(() => Traced.resolve([])).toThrow(
      /class unit 'WithTracing'.*resolve\(resolver\)/s,
    );
  });

  it('повторный resolve не вызывает фабрику второй раз', async () => {
    const factory = jest.fn((users: UserService) => async () => new Ok({}));

    const Endpoint = makeEndpoint({
      transport: 'http',
      pattern: 'GET /twice',
      deps: [UserService],
      handle: factory,
    });

    const once = Endpoint.resolve([new UserService()]);
    const twice = once.resolve([]);

    await twice.handle(undefined, meta);

    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe('makeEndpoint — бренд', () => {
  const Ping = makeEndpoint({
    transport: 'http',
    pattern: 'GET /ping',
    handle: async () => new Ok({ pong: true }),
  });

  it('декларация опознаётся предикатом', () => {
    expect(isEndpointDefinition(Ping)).toBe(true);
  });

  it('посторонние значения предикатом не опознаются', () => {
    class NotAnEndpoint {
      find() {
        return null;
      }
    }

    expect(isEndpointDefinition({ transport: 'http', pattern: 'GET /' })).toBe(
      false,
    );
    expect(isEndpointDefinition(NotAnEndpoint)).toBe(false);
    expect(isEndpointDefinition(undefined)).toBe(false);
    expect(isEndpointDefinition(null)).toBe(false);
  });

  it('бренд не участвует в перечислении и сериализации', () => {
    expect(Object.keys(Ping)).toEqual(
      expect.not.arrayContaining([expect.stringContaining('nestling')]),
    );
    expect(Object.getOwnPropertySymbols({ ...Ping })).toHaveLength(0);
    expect(() => JSON.stringify({ ...Ping, handle: undefined })).not.toThrow();
  });

  it('создание декларации не имеет побочных эффектов', () => {
    const created = makeEndpoint({
      transport: 'http',
      pattern: 'GET /side-effect-free',
      handle: async () => new Ok({}),
    });

    // Никаких реестров: значение существует ровно там, куда его положили
    expect(created.transport).toBe('http');
    expect(created.pattern).toBe('GET /side-effect-free');
  });
});

// ============================================================================
// Типовые тесты
// ============================================================================

describe('makeEndpoint — типы', () => {
  it('TNeeds отражает форму хендлера', () => {
    const DepsFree = makeEndpoint({
      transport: 'http',
      pattern: 'GET /ping',
      handle: async () => new Ok({ pong: true }),
    });

    const Curried = makeEndpoint({
      transport: 'http',
      pattern: 'GET /users/:id',
      deps: [UserService, ILogger],
      handle: (users, logger) => async () => new Ok({}),
    });

    class GetUserHandler {
      async handle() {
        return new Ok({});
      }
    }

    const WithClass = makeEndpoint({
      transport: 'http',
      pattern: 'GET /class',
      handle: GetUserHandler,
    });

    type _DepsFree = Expect<Equal<InferNeeds<typeof DepsFree>, never>>;
    type _Curried = Expect<
      Equal<
        InferNeeds<typeof Curried>,
        typeof UserService | TokenString<ILoggerService>
      >
    >;
    type _WithClass = Expect<
      Equal<InferNeeds<typeof WithClass>, typeof GetUserHandler>
    >;

    // Гашение возвращает исполнимую декларацию
    type _Resolved = Expect<
      Equal<InferNeeds<ReturnType<typeof Curried.resolve>>, never>
    >;

    expect(DepsFree.pattern).toBe('GET /ping');
  });

  it('классы-юниты пайплайна попадают в TNeeds декларации', () => {
    class WithTracing {
      handle(): { traceId: string } {
        return { traceId: 'trace' };
      }
    }

    const Traced = makeEndpoint({
      transport: 'http',
      pattern: 'GET /traced',
      pipeline: makePipeline().pre(WithTracing),
      handle: async () => new Ok({}),
    });

    type _Traced = Expect<Equal<InferNeeds<typeof Traced>, typeof WithTracing>>;

    expect(Traced.pattern).toBe('GET /traced');
  });

  it('исполнимая декларация присваиваема, декларация с deps — нет', () => {
    const DepsFree = makeEndpoint({
      transport: 'http',
      pattern: 'GET /ping',
      handle: async () => new Ok({}),
    });

    const Curried = makeEndpoint({
      transport: 'http',
      pattern: 'GET /users',
      deps: [UserService],
      handle: (users) => async () => new Ok({}),
    });

    const executable: EndpointDefinition<any, any, any, never> = DepsFree;

    // @ts-expect-error: декларация с неразрешёнными deps не исполнима
    const rejected: EndpointDefinition<any, any, any, never> = Curried;

    expect(executable.pattern).toBe('GET /ping');
  });

  it('несовпадение сигнатуры handle со схемами — ошибка компиляции', () => {
    makeEndpoint({
      transport: 'http',
      pattern: 'GET /users/:id',
      input: UserInput,
      output: UserOutput,
      // @ts-expect-error: input даёт { id: string }, хендлер ждёт число
      handle: async (input: { id: number }) => new Ok({ id: '1', name: 'a' }),
    });

    // @ts-expect-error: output требует { id, name }, хендлер отдаёт другое
    makeEndpoint({
      transport: 'http',
      pattern: 'GET /users/:id',
      input: UserInput,
      output: UserOutput,
      handle: async () => new Ok({ unexpected: true }),
    });

    expect(true).toBe(true);
  });

  it('deps без каррированной формы хендлера — ошибка компиляции', () => {
    makeEndpoint({
      transport: 'http',
      pattern: 'GET /users',
      deps: [UserService],
      // @ts-expect-error: с deps хендлер обязан быть каррированной фабрикой
      handle: async () => new Ok({}),
    });

    expect(true).toBe(true);
  });
});
