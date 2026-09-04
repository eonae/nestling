/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable unicorn/consistent-function-scoping, unicorn/no-useless-undefined */
/**
 * Декларация endpoint'а — значение: рантайм двух форм `handler`, получение
 * зависимостей и бренд. Плюс типовые тесты на `TNeeds`.
 */

import { Ok } from '../core/index.js';
import { makePipeline } from '../core/pipeline.js';

import type { EndpointDefinition } from './endpoint.js';
import {
  isEndpointDefinition,
  makeEndpoint,
  transportNameOf,
} from './endpoint.js';

import { describe, expect, it, jest } from '@jest/globals';
import type { Token } from '@nestling/container';
import { makeToken } from '@nestling/container';
import { z } from 'zod';

/** Токен транспорта фикстур: декларация ссылается на транспорт значением */
const HttpTransport$ = makeToken('transport:http');

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

/** Класс-хендлер фикстур: зависимость приходит конструктором */
class GetUserHandler {
  constructor(private readonly users: UserService) {}

  async handle(input: { id: string }) {
    return new Ok(this.users.getById(input.id));
  }
}

const UserInput = z.object({ id: z.string() });
const UserOutput = z.object({ id: z.string(), name: z.string() });

/**
 * Вызов `makeEndpoint` так, как его сделает потребитель без типов: словарь
 * подставляется мимо перегрузок, проверяется рантайм. Компилятор те же
 * случаи ловит в разделе типовых тестов.
 */
const makeEndpointFromJs = (options: unknown) =>
  makeEndpoint(options as Parameters<typeof makeEndpoint>[0]);

/** Зарезервированный ключ meta: его инъецирует рантайм пайплайна */
const meta = {
  signal: new AbortController().signal,
};

// ============================================================================
// Рантайм
// ============================================================================

describe('makeEndpoint — формы handler', () => {
  it('голая функция исполнима сразу, без резолва', async () => {
    const Ping = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /ping',
      handler: async () => new Ok({ pong: true }),
    });

    await expect(Ping.handle(undefined, meta)).resolves.toEqual(
      new Ok({ pong: true }),
    );
  });

  it('класс-хендлер исполняется после resolve и сохраняет this', async () => {
    const GetUser = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /users/:id',
      input: UserInput,
      output: UserOutput,
      handler: GetUserHandler,
    });

    const instance = new GetUserHandler(new UserService());
    const resolved = GetUser.resolve(() => instance);

    await expect(resolved.handle({ id: '1' }, meta)).resolves.toEqual(
      new Ok({ id: '1', name: 'Alice' }),
    );
  });

  it('до получения зависимостей handle бросает понятную ошибку', () => {
    const GetUser = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /users/:id',
      input: UserInput,
      handler: GetUserHandler,
    });

    expect(() => GetUser.handle({ id: '1' }, meta)).toThrow(
      /GET \/users\/:id.*unresolved dependencies/s,
    );
  });

  it('инстанс класса-хендлера создаётся один раз на несколько запросов', async () => {
    const resolver = jest.fn(() => new GetUserHandler(new UserService()));

    const Endpoint = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /counted',
      input: UserInput,
      handler: GetUserHandler,
    });

    const resolved = Endpoint.resolve(resolver);

    await resolved.handle({ id: '1' }, meta);
    await resolved.handle({ id: '1' }, meta);
    await resolved.handle({ id: '1' }, meta);

    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('объект в handler отвергается с указанием на класс-форму', () => {
    expect(() =>
      makeEndpointFromJs({
        transport: HttpTransport$,
        pattern: 'GET /users',
        handler: {
          deps: [UserService],
          handle: (users: UserService) => async () => new Ok({}),
        },
      }),
    ).toThrow(
      /Endpoint 'GET \/users'.*@Injectable\(\[\.{3}]\) with a handle\(\) method/s,
    );
  });

  it('поля deps и handle на верхнем уровне словаря отвергаются', () => {
    expect(() =>
      makeEndpointFromJs({
        transport: HttpTransport$,
        pattern: 'GET /users',
        deps: [UserService],
        handler: async () => new Ok({}),
      }),
    ).toThrow(/'deps' is not a field of the declaration/);
  });
});

describe('makeEndpoint — resolve', () => {
  const declaration = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'GET /users/:id',
    input: UserInput,
    handler: GetUserHandler,
  });

  const newHandler = () => new GetUserHandler(new UserService());

  it('возвращает новое значение, исходную декларацию не трогает', async () => {
    const first = declaration.resolve(newHandler);
    const second = declaration.resolve(newHandler);

    expect(first).not.toBe(declaration);
    expect(first).not.toBe(second);

    // Исходная по-прежнему не исполнима
    expect(() => declaration.handle({ id: '1' }, meta)).toThrow(
      /unresolved dependencies/,
    );
    await expect(first.handle({ id: '1' }, meta)).resolves.toBeInstanceOf(Ok);
    await expect(second.handle({ id: '1' }, meta)).resolves.toBeInstanceOf(Ok);
  });

  it('резолвер, не отдавший класс-хендлер, — ошибка с именем класса', () => {
    expect(() => declaration.resolve(() => undefined)).toThrow(
      /class handler 'GetUserHandler'.*not provided by the resolver/s,
    );
  });

  it('позиционная форма не принимается', () => {
    const positional = [new GetUserHandler(new UserService())];

    expect(() =>
      (declaration.resolve as (argument: unknown) => unknown)(positional),
    ).toThrow(/resolve takes a resolver.*container\.getOrThrow/s);
  });

  it('связывает классы-юниты пайплайна тем же резолвером', async () => {
    class WithTracing {
      handle(): { traceId: string } {
        return { traceId: 'trace' };
      }
    }

    const Traced = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /traced',
      pipeline: makePipeline().pre(WithTracing),
      handler: async () => new Ok({}),
    });

    const resolved = Traced.resolve(() => new WithTracing());

    // Пайплайн стал исполнимым: bind прошёл на тех же зависимостях
    expect(resolved.pipeline).toBeDefined();
    expect(resolved.pipeline).not.toBe(Traced.pipeline);
  });

  it('повторный resolve не создаёт инстанс второй раз', async () => {
    const resolver = jest.fn(() => new GetUserHandler(new UserService()));

    const Endpoint = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /twice',
      input: UserInput,
      handler: GetUserHandler,
    });

    const once = Endpoint.resolve(resolver);
    const twice = once.resolve(() => undefined);

    await twice.handle({ id: '1' }, meta);

    expect(resolver).toHaveBeenCalledTimes(1);
  });
});

describe('makeEndpoint — бренд', () => {
  const Ping = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'GET /ping',
    handler: async () => new Ok({ pong: true }),
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

    expect(
      isEndpointDefinition({ transport: HttpTransport$, pattern: 'GET /' }),
    ).toBe(false);
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
      transport: HttpTransport$,
      pattern: 'GET /side-effect-free',
      handler: async () => new Ok({}),
    });

    // Никаких реестров: значение существует ровно там, куда его положили
    expect(created.transport).toBe(HttpTransport$);
    expect(created.pattern).toBe('GET /side-effect-free');
  });
});

describe('ссылка на транспорт — токен', () => {
  it('декларация несёт именно токен, а имя выводится из его id', () => {
    const Ping = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /ping',
      handler: async () => new Ok({}),
    });

    expect(Ping.transport).toBe(HttpTransport$);
    expect(transportNameOf(Ping.transport)).toBe('http');
  });

  it('два транспорта различимы по токену, а не по имени', () => {
    const Cli$ = makeToken('transport:cli');

    const Command = makeEndpoint({
      transport: Cli$,
      pattern: 'sync',
      handler: async () => new Ok({}),
    });

    expect(Command.transport).not.toBe(HttpTransport$);
    expect(transportNameOf(Command.transport)).toBe('cli');
  });

  it('токен без префикса остаётся своим же именем', () => {
    expect(transportNameOf(makeToken('bus'))).toBe('bus');
  });
});

describe('makeEndpoint — носитель binding', () => {
  // Форма карты транспорта ядру неизвестна: здесь это произвольное значение
  const binding = { fields: { id: { in: 'path' } }, rest: 'body' };

  it('binding передаётся в значение декларации как есть', () => {
    const UpdateUser = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'PATCH /users/:id',
      binding,
      handler: async () => new Ok({}),
    });

    expect(UpdateUser.binding).toBe(binding);
  });

  it('binding переживает получение зависимостей', () => {
    const GetUser = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /users/:id',
      input: UserInput,
      binding,
      handler: GetUserHandler,
    });

    const resolved = GetUser.resolve(
      () => new GetUserHandler(new UserService()),
    );

    expect(resolved.binding).toBe(binding);
    // Декларация иммутабельна: исходная не тронута
    expect(GetUser.binding).toBe(binding);
  });

  it('без binding поле на значении не появляется', () => {
    const Ping = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /ping',
      handler: async () => new Ok({ pong: true }),
    });

    expect('binding' in Ping).toBe(false);
  });

  it('ядро в носитель не заглядывает: годится любое значение', () => {
    const opaque = Symbol('transport-specific');

    const Weird = makeEndpoint({
      transport: makeToken('transport:nats'),
      pattern: 'users.get',
      binding: opaque,
      handler: async () => new Ok({}),
    });

    expect(Weird.binding).toBe(opaque);
  });
});

describe('@nestling/pipeline — HTTP-слепота ядра', () => {
  it('публичные экспорты не содержат понятий частей HTTP-запроса', async () => {
    const kernel = await import('../index.js');

    // Ядро не знает слов path/query/body: их вводит транспорт над `binding`
    const httpish = Object.keys(kernel).filter((name) =>
      /^(path|query|body|header)/i.test(name),
    );

    expect(httpish).toEqual([]);
  });
});

// ============================================================================
// Типовые тесты
// ============================================================================

describe('makeEndpoint — типы', () => {
  it('TNeeds отражает форму хендлера', () => {
    const DepsFree = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /ping',
      handler: async () => new Ok({ pong: true }),
    });

    const WithClass = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /class',
      input: UserInput,
      handler: GetUserHandler,
    });

    type _DepsFree = Expect<Equal<InferNeeds<typeof DepsFree>, never>>;
    type _WithClass = Expect<
      Equal<InferNeeds<typeof WithClass>, typeof GetUserHandler>
    >;

    // Получение зависимостей возвращает исполнимую декларацию
    type _Resolved = Expect<
      Equal<InferNeeds<ReturnType<typeof WithClass.resolve>>, never>
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
      transport: HttpTransport$,
      pattern: 'GET /traced',
      pipeline: makePipeline().pre(WithTracing),
      handler: async () => new Ok({}),
    });

    type _Traced = Expect<Equal<InferNeeds<typeof Traced>, typeof WithTracing>>;

    expect(Traced.pattern).toBe('GET /traced');
  });

  it('исполнимая декларация присваиваема, декларация с классом — нет', () => {
    const DepsFree = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /ping',
      handler: async () => new Ok({}),
    });

    const WithClass = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /users',
      input: UserInput,
      handler: GetUserHandler,
    });

    const executable: EndpointDefinition<any, any, any, never> = DepsFree;

    // @ts-expect-error: декларация с неразрешёнными зависимостями не исполнима
    const rejected: EndpointDefinition<any, any, any, never> = WithClass;

    expect(executable.pattern).toBe('GET /ping');
  });

  it('несовпадение сигнатуры handle со схемами — ошибка компиляции', () => {
    makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /users/:id',
      input: UserInput,
      output: UserOutput,
      // @ts-expect-error: input даёт { id: string }, хендлер ждёт число
      handler: async (input: { id: number }) => new Ok({ id: '1', name: 'a' }),
    });

    // @ts-expect-error: output требует { id, name }, хендлер отдаёт другое
    makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /users/:id',
      input: UserInput,
      output: UserOutput,
      handler: async () => new Ok({ unexpected: true }),
    });

    expect(true).toBe(true);
  });

  it('объект в handler и позиционный resolve — ошибки компиляции', () => {
    // Обе записи отвергает и рантайм, поэтому здесь они только компилируются
    const compileOnly = () => {
      makeEndpoint({
        transport: HttpTransport$,
        pattern: 'GET /users',
        handler: {
          // @ts-expect-error: `handler` принимает функцию или класс, не объект
          deps: [UserService],
          handle: async () => new Ok({}),
        },
      });

      const WithClass = makeEndpoint({
        transport: HttpTransport$,
        pattern: 'GET /users',
        input: UserInput,
        handler: GetUserHandler,
      });

      // @ts-expect-error: `resolve` принимает резолвер, а не массив инстансов
      WithClass.resolve([new GetUserHandler(new UserService())]);
    };

    expect(compileOnly).toBeInstanceOf(Function);
  });
});
