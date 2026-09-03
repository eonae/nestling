/**
 * Одна карта на обоих концах сети.
 *
 * Два теста об одном: клиент собирает запрос по bind-карте операции, а
 * транспорт разбирает его по **той же карте, взятой с того же значения**.
 * Первый проверяет инвариант на наборе карт без сети, второй — на поднятом
 * сервере с настоящим `makeClient`.
 *
 * Инвариант нельзя выводить из совпадения реализаций: они писались
 * отдельно, и разойтись им ничто не мешает, кроме этой проверки.
 */

import { assemblePayload, query, readQuery } from './binding.js';
import { httpEndpoint } from './helpers.js';
import { HttpTransport } from './transport.js';

import { describe, expect, it } from '@jest/globals';
import { makeClient } from '@nestling/client';
import type { HttpBinding } from '@nestling/operations';
import { makeFail, makeRequest } from '@nestling/operations';
import { Fail, Ok } from '@nestling/pipeline';
import type { ExecutableDeclaration } from '@nestling/transport';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Round-trip без сети
// ---------------------------------------------------------------------------

/** Захваченный запрос: то, что клиент отдал бы в сеть */
interface Captured {
  url: string;
  body?: string;
}

/** `fetch`-двойник, который ничего не шлёт, а записывает */
function capturing(sink: Captured[]): typeof globalThis.fetch {
  return ((input: string | URL | Request, init: RequestInit = {}) => {
    sink.push({
      url: String(input),
      ...(typeof init.body === 'string' ? { body: init.body } : {}),
    });
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof globalThis.fetch;
}

/**
 * Разбирает запрос ровно так, как это делает транспорт: path-параметры из
 * совпадения с шаблоном, query через `readQuery`, тело как JSON — и собирает
 * payload `assemblePayload`'ом.
 */
function parseAsTransport(binding: HttpBinding, captured: Captured): unknown {
  const url = new URL(captured.url);

  const template = binding.path.split('/');
  const actual = url.pathname.split('/');
  const params: Record<string, string> = {};
  for (const [index, segment] of template.entries()) {
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = decodeURIComponent(actual[index]);
    }
  }

  return assemblePayload(binding, {
    query: readQuery(url.searchParams, binding.fields),
    body: captured.body === undefined ? undefined : JSON.parse(captured.body),
    params,
  });
}

const Wide = z.object({
  id: z.string(),
  name: z.string().optional(),
  tag: z.array(z.string()).optional(),
  note: z.string().optional(),
});

const roundTripCases = [
  {
    title: 'path-параметр и остальное в теле',
    operation: makeRequest({
      name: 'roundtrip.patch',
      http: 'PATCH /users/:id',
      input: Wide,
      output: z.object({ ok: z.boolean() }),
    }),
    payload: { id: '42', name: 'Alice', note: 'hi' },
  },
  {
    title: 'метод без тела: rest — query',
    operation: makeRequest({
      name: 'roundtrip.get',
      http: 'GET /users',
      input: Wide,
      output: z.object({ ok: z.boolean() }),
    }),
    payload: { id: '42', name: 'Alice' },
  },
  {
    title: 'пометка вытаскивает поле из тела в query',
    operation: makeRequest({
      name: 'roundtrip.marked',
      http: { method: 'POST', path: '/users', bind: { name: query() } },
      input: Wide,
      output: z.object({ ok: z.boolean() }),
    }),
    payload: { id: '42', name: 'Alice', note: 'hi' },
  },
  {
    title: 'query({ multiple: true }) с одним вхождением остаётся массивом',
    operation: makeRequest({
      name: 'roundtrip.multiple',
      http: {
        method: 'POST',
        path: '/users/:id',
        bind: { tag: query({ multiple: true }) },
      },
      input: Wide,
      output: z.object({ ok: z.boolean() }),
    }),
    payload: { id: '7', tag: ['a'], note: 'hi' },
  },
  {
    title: 'массив из нескольких вхождений',
    operation: makeRequest({
      name: 'roundtrip.multiple.many',
      http: {
        method: 'POST',
        path: '/users/:id',
        bind: { tag: query({ multiple: true }) },
      },
      input: Wide,
      output: z.object({ ok: z.boolean() }),
    }),
    payload: { id: '7', tag: ['a', 'b', 'c'] },
  },
];

describe('round-trip: клиент собрал → транспорт разобрал', () => {
  it.each(roundTripCases)('$title', async ({ operation, payload }) => {
    const captured: Captured[] = [];
    const api = makeClient(
      { call: operation },
      { baseUrl: 'https://api.example.com', fetch: capturing(captured) },
    );

    await api.call(payload as never);

    expect(
      parseAsTransport(operation.http as HttpBinding, captured[0]),
    ).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// Интеграция: поднятый сервер и настоящий клиент
// ---------------------------------------------------------------------------

const User = z.object({ id: z.string(), email: z.string() });

const EmailTaken = makeFail('conflict:integration_email_taken', {
  message: 'Email already taken',
  details: z.object({ email: z.string() }),
});

const CreateUser = makeRequest({
  name: 'integration.users.create',
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: z.object({
    email: z.string(),
    // Схема query-поля обязана принимать **сериализованную** форму: query
    // несёт строки, и клиент пишет туда `String(value)`. `z.boolean()`
    // здесь отверг бы законный `?dryRun=true` — это не дефект клиента, а
    // свойство сериализации в query-строку, и схема должна его знать
    dryRun: z.coerce.boolean().optional(),
  }),
  output: User,
  errors: [EmailTaken],
});

const GetUser = makeRequest({
  name: 'integration.users.get',
  http: 'GET /users/:id',
  input: z.object({ id: z.string() }),
  output: User,
});

const CreateUserRoute = httpEndpoint({
  operation: CreateUser,
  handler: async ({ email, dryRun }) => {
    if (email === 'taken@example.com') {
      return EmailTaken({ email });
    }
    if (email === 'boom@example.com') {
      // Незадекларированный отказ — именно броском: вернуть его типы не
      // дают (множество E закрыто), а граница обязана нормализовать его в
      // internal_error, и клиент не должен притвориться, будто знает, что это
      throw Fail.forbidden('nope');
    }
    return new Ok({ id: dryRun === true ? 'dry' : 'u-1', email });
  },
});

const GetUserRoute = httpEndpoint({
  operation: GetUser,
  handler: async ({ id }) =>
    new Promise<Ok<{ id: string; email: string }>>((resolve) => {
      // Достаточно медленно, чтобы успеть отменить
      setTimeout(() => resolve(new Ok({ id, email: 'slow@example.com' })), 200);
    }),
});

describe('интеграция: операция-форма httpEndpoint + makeClient', () => {
  let transport: HttpTransport;
  let baseUrl: string;

  beforeAll(async () => {
    transport = new HttpTransport({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();

    const routes: ExecutableDeclaration[] = [
      CreateUserRoute as unknown as ExecutableDeclaration,
      GetUserRoute as unknown as ExecutableDeclaration,
    ];

    await transport.serve(makeDispatch(routes), controller.signal);

    const address = transport.address();
    if (!address) {
      throw new Error('transport did not report an address after serve()');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await transport.close();
  });

  const client = () =>
    makeClient({ createUser: CreateUser, getUser: GetUser }, { baseUrl });

  it('успех: значение прошло схему ответа', async () => {
    const result = await client().createUser({ email: 'a@b.c' });

    expect(result).toMatchObject({
      isFail: false,
      status: 'ok',
      value: { id: 'u-1', email: 'a@b.c' },
    });
  });

  it('помеченное поле передалось query-строкой', async () => {
    const result = await client().createUser({
      email: 'a@b.c',
      dryRun: true,
    });

    expect(result).toMatchObject({ value: { id: 'dry' } });
  });

  it('задекларированный отказ передаётся кодом и деталями', async () => {
    const result = await client().createUser({ email: 'taken@example.com' });

    expect(EmailTaken.is(result)).toBe(true);
    expect(result).toMatchObject({
      code: 'conflict:integration_email_taken',
      details: { email: 'taken@example.com' },
    });
    // Категория — производная от кода, а не поле с провода
    expect((result as { category: string }).category).toBe('conflict');
  });

  it('незадекларированный отказ приходит как internal_error', async () => {
    const result = await client().createUser({ email: 'boom@example.com' });

    expect(result).toMatchObject({ isFail: true, code: 'internal_error' });
    expect(EmailTaken.is(result)).toBe(false);
  });

  it('отмена по signal даёт internal_error, а не исключение', async () => {
    const controllerForCall = new AbortController();
    const pending = client().getUser(
      { id: '42' },
      { signal: controllerForCall.signal },
    );

    controllerForCall.abort();

    expect(await pending).toMatchObject({
      isFail: true,
      code: 'internal_error',
    });
  });
});
