/**
 * Секция `http` операции: две формы записи, вычисление bind-карты при
 * создании, проверки и независимость от шины.
 */

import { body, computeHttpBinding, query } from './http/binding.js';
import { events, multipart, stream, upload } from './io/index.js';
import { makeCommand, makeEvent, makeRequest } from './contract.js';
import { defineFail } from './define-fail.js';

import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

const User = z.object({
  id: z.string(),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const Activity = z.object({ kind: z.string() });

/** Уникальное имя на каждый вызов: имя операции регистрируется один раз */
let counter = 0;
const uniqueName = (prefix: string): string =>
  `${prefix}.${(counter += 1).toString()}`;

describe('секция http: формы записи', () => {
  it('строковая форма даёт адрес', () => {
    const CreateUser = makeRequest({
      name: uniqueName('http.users.create'),
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
    const CreateUser = makeRequest({
      name: uniqueName('http.users.create'),
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
    const GetUser = makeRequest({
      name: uniqueName('http.users.get'),
      http: 'GET /users/:id',
      input: User,
      output: User,
    });

    expect(Object.isFrozen(GetUser.http)).toBe(true);
    expect(GetUser.http?.fields).toEqual({ id: { in: 'path' } });
  });

  it('операция без секции остаётся операцией шины', () => {
    const Placed = makeEvent({
      name: uniqueName('http.orders.placed'),
      input: User,
    });

    expect(Placed.http).toBeUndefined();
    expect('http' in Placed).toBe(false);
  });
});

/** Дефектный операция: имя уникально, всё остальное — из аргументов */
const create = (http: unknown, extra: Record<string, unknown> = {}) =>
  makeRequest({
    name: uniqueName('http.broken'),
    http: http as string,
    ...extra,
  } as never);

describe('секция http: проверки при создании', () => {
  it('некорректная строковая форма называет операция и ожидаемую запись', () => {
    expect(() => create('POST')).toThrow(
      /Operation 'http\.broken\.\d+': the string form of 'http' must be '<METHOD> <path>'/,
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
      /Operation 'http\.broken\.\d+': path parameter ':id' has nowhere to go — the declaration has no 'input'/,
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

describe('карта операции совпадает с картой одноимённой декларации', () => {
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
    const Operation = makeRequest({
      name: uniqueName('http.parity'),
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

    // Имя операции исключено из сравнения: оно не часть правила
    // размещения. У анонимной декларации его нет, а карта операции хранит
    // его для генератора документации.
    const { contract: owner, ...placement } = Operation.http ?? {};

    expect(owner).toBe(Operation.name);
    expect(placement).toEqual({ ...declaration });
  });
});

describe('секция http не меняет операция шины', () => {
  const EmailTaken = defineFail('HTTP_SPEC_EMAIL_TAKEN', {
    status: 'CONFLICT',
    message: 'Email already taken',
  });

  it('вид, вызыватель и errors: остаются прежними', () => {
    const CreateUser = makeRequest({
      name: uniqueName('http.parity.request'),
      http: 'POST /users',
      input: User,
      output: User,
      errors: [EmailTaken],
    });

    expect(CreateUser.kind).toBe('request');
    expect(CreateUser.caller.id).toBe(`Port:${CreateUser.name}`);
    expect(CreateUser.errors).toEqual([EmailTaken]);
    expect(() => (CreateUser as { emitter?: unknown }).emitter).toThrow(
      /has no '\.emitter'/,
    );
  });

  it('command с http: сохраняет эмиттер и durable', () => {
    const Notify = makeCommand({
      name: uniqueName('http.parity.command'),
      http: 'POST /notify',
      input: User,
      durable: true,
    });

    expect(Notify.kind).toBe('command');
    expect(Notify.emitter.id).toBe(`Emitter:${Notify.name}`);
    expect(Notify.durable).toBe(true);
  });
});
