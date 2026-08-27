/**
 * Секция `http:` контракта: две формы записи, разворачивание в bind-карту в
 * момент создания значения, fail-fast словаря и невмешательство в шину.
 */

import { body, computeHttpBinding, query } from './http/binding.js';
import { events, multipart, stream, upload } from './io/index.js';
import { makeContract } from './contract.js';
import { defineFail } from './define-fail.js';

import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

const User = z.object({
  id: z.string(),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const Activity = z.object({ kind: z.string() });

/** Уникальное имя на вызов: имя контракта — адрес, и он занимается один раз */
let counter = 0;
const uniqueName = (prefix: string): string =>
  `${prefix}.${(counter += 1).toString()}`;

describe('секция http: формы записи', () => {
  it('строковая форма даёт адрес', () => {
    const CreateUser = makeContract({
      name: uniqueName('http.users.create'),
      kind: 'request',
      http: 'POST /users',
      input: User,
      output: User,
    });

    expect(CreateUser.http).toMatchObject({
      method: 'POST',
      path: '/users',
      rest: 'body',
      fields: {},
    });
  });

  it('развёрнутая форма несёт тот же адрес и размещает помеченное поле', () => {
    const CreateUser = makeContract({
      name: uniqueName('http.users.create'),
      kind: 'request',
      http: { method: 'POST', path: '/users', bind: { name: query() } },
      input: User,
      output: User,
    });

    expect(CreateUser.http).toMatchObject({
      method: 'POST',
      path: '/users',
      fields: { name: { in: 'query' } },
      rest: 'body',
    });
  });

  it('карта иммутабельна и доступна с самого значения', () => {
    const GetUser = makeContract({
      name: uniqueName('http.users.get'),
      kind: 'request',
      http: 'GET /users/:id',
      input: User,
      output: User,
    });

    expect(Object.isFrozen(GetUser.http)).toBe(true);
    expect(GetUser.http?.fields).toEqual({ id: { in: 'path' } });
  });

  it('контракт без секции остаётся контрактом шины', () => {
    const Placed = makeContract({
      name: uniqueName('http.orders.placed'),
      kind: 'event',
      input: User,
    });

    expect(Placed.http).toBeUndefined();
    expect('http' in Placed).toBe(false);
  });
});

/** Дефектный контракт: имя уникально, всё остальное — из аргументов */
const create = (http: unknown, extra: Record<string, unknown> = {}) =>
  makeContract({
    name: uniqueName('http.broken'),
    kind: 'request',
    http: http as string,
    ...extra,
  } as never);

describe('секция http: fail-fast словаря', () => {
  it('битая строковая форма называет контракт и ожидаемую запись', () => {
    expect(() => create('POST')).toThrow(
      /Contract 'http\.broken\.\d+': the string form of 'http' must be '<METHOD> <path>'/,
    );
    expect(() => create('POST /users extra')).toThrow(
      /the string form of 'http' must be '<METHOD> <path>'/,
    );
    expect(() => create('POST  /users')).toThrow(
      /the string form of 'http' must be '<METHOD> <path>'/,
    );
  });

  it('пустой путь и путь без ведущего слэша', () => {
    expect(() => create({ method: 'GET', path: '' })).toThrow(
      /'path' must be a non-empty string/,
    );
    expect(() => create({ method: 'GET', path: 'users' })).toThrow(
      /'path' must start with '\/'/,
    );
  });

  it('повторяющийся path-параметр', () => {
    expect(() =>
      create({ method: 'GET', path: '/users/:id/orders/:id' }, { input: User }),
    ).toThrow(/path parameter ':id' is declared twice/);
  });

  it('пометка на path-параметре', () => {
    expect(() =>
      create(
        { method: 'PATCH', path: '/users/:id', bind: { id: query() } },
        { input: User },
      ),
    ).toThrow(/field 'id' is the path parameter ':id'/);
  });

  it('body() у метода без тела', () => {
    expect(() =>
      create(
        { method: 'GET', path: '/users', bind: { name: body() } },
        { input: User },
      ),
    ).toThrow(/'name' is bound to the body, but 'GET' has no request body/);
  });

  it('bind при неструктурном input', () => {
    expect(() =>
      create(
        { method: 'POST', path: '/logs', bind: { name: query() } },
        { input: stream(User) },
      ),
    ).toThrow(/'bind' is not applicable to a non-structural input/);
  });

  it('path-параметр без input и при неструктурном input', () => {
    expect(() => create('GET /users/:id')).toThrow(
      /Contract 'http\.broken\.\d+': path parameter ':id' has nowhere to go — the declaration has no 'input'/,
    );

    expect(() =>
      create({ method: 'POST', path: '/logs/:id' }, { input: stream(User) }),
    ).toThrow(/path parameter ':id' has nowhere to go/);
  });

  it('rawBody вместе с потоковой и multipart-формой', () => {
    expect(() =>
      create(
        { method: 'POST', path: '/hooks', rawBody: true },
        { input: stream(User) },
      ),
    ).toThrow(/'rawBody: true' is not compatible/);

    expect(() =>
      create(
        { method: 'POST', path: '/hooks', rawBody: true },
        { input: multipart({ files: { blob: upload() } }) },
      ),
    ).toThrow(/'rawBody: true' is not compatible/);
  });

  it('sse при не-events-выходе и зарезервированное имя события', () => {
    expect(() =>
      create({ method: 'GET', path: '/feed', sse: { heartbeat: 1000 } }),
    ).toThrow(/'sse' is only meaningful for an events\(\.\.\.\) output/);

    expect(() =>
      create(
        { method: 'GET', path: '/feed', sse: { event: () => 'error' } },
        { output: events(Activity) },
      ),
    ).toThrow(/SSE event name 'error' is reserved/);
  });

  it('поле исполнения в секции отвергается', () => {
    expect(() =>
      create({ method: 'GET', path: '/users', handle: () => 1 }),
    ).toThrow(
      /'http\.handle' describes how a request is handled, and a contract declares only where it is addressed/,
    );
  });

  it('секция не той формы отвергается', () => {
    expect(() => create(42)).toThrow(
      /'http' must be either the string '<METHOD> <path>' or a record/,
    );
  });
});

describe('карта контракта совпадает с картой одноимённой декларации', () => {
  /**
   * Общий набор случаев: то же правило, вызванное из двух мест, обязано
   * давать структурно тот же результат. Сравнение — на равенство значений, а
   * не на «обе не бросили».
   */
  const cases: {
    title: string;
    method: string;
    path: string;
    bind?: Record<string, ReturnType<typeof query>>;
    rawBody?: boolean;
    input?: unknown;
  }[] = [
    {
      title: 'path-параметр',
      method: 'PATCH',
      path: '/users/:id',
      input: User,
    },
    { title: 'метод без тела', method: 'GET', path: '/users', input: User },
    {
      title: 'пометки, включая multiple',
      method: 'POST',
      path: '/users',
      bind: { name: query(), tags: query({ multiple: true }) },
      input: User,
    },
    {
      title: 'сырые байты тела',
      method: 'POST',
      path: '/hooks/stripe',
      rawBody: true,
      input: User,
    },
    {
      title: 'multipart структурен',
      method: 'POST',
      path: '/users/:id/avatar',
      bind: { name: query() },
      input: multipart({ fields: User, files: { avatar: upload() } }),
    },
  ];

  it.each(cases)('$title', ({ method, path, bind, rawBody, input }) => {
    const Contract = makeContract({
      name: uniqueName('http.parity'),
      kind: 'request',
      http: { method: method as 'POST', path, bind, rawBody } as never,
      input: input as never,
    });

    // Ровно тот вызов, который делает конструктор HTTP-декларации
    const declaration = computeHttpBinding({
      method,
      path,
      bind,
      rawBody,
      input,
      where: `httpEndpoint({ method: '${method}', path: '${path}' })`,
    });

    // Имя владельца из сравнения вычитается намеренно: оно не часть правила
    // размещения. У анонимной декларации владельца-контракта нет, а карта
    // контракта его несёт — из него генератор документации выводит
    // `operationId`.
    const { contract: owner, ...placement } = Contract.http ?? {};

    expect(owner).toBe(Contract.name);
    expect(placement).toEqual({ ...declaration });
  });
});

describe('http: ничего не меняет в контракте шины', () => {
  const EmailTaken = defineFail('HTTP_SPEC_EMAIL_TAKEN', {
    status: 'CONFLICT',
    message: 'Email already taken',
  });

  it('вид, вызыватель и errors: остаются прежними', () => {
    const CreateUser = makeContract({
      name: uniqueName('http.parity.request'),
      kind: 'request',
      http: 'POST /users',
      input: User,
      output: User,
      errors: [EmailTaken],
    });

    expect(CreateUser.kind).toBe('request');
    expect(CreateUser.port).toBe(`Port:${CreateUser.name}`);
    expect(CreateUser.errors).toEqual([EmailTaken]);
    expect(() => (CreateUser as { emitter?: unknown }).emitter).toThrow(
      /has no '\.emitter'/,
    );
  });

  it('command с http: сохраняет эмиттер и durable', () => {
    const Notify = makeContract({
      name: uniqueName('http.parity.command'),
      kind: 'command',
      http: 'POST /notify',
      input: User,
      durable: true,
    });

    expect(Notify.kind).toBe('command');
    expect(Notify.emitter).toBe(`Emitter:${Notify.name}`);
    expect(Notify.durable).toBe(true);
  });
});
