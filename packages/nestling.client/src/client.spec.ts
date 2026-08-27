/**
 * `makeClient`: форма API-объекта, fail-fast создания, сборка запроса,
 * коерсия query, разбор успеха и рематериализация отказа.
 *
 * Сеть подменяется `fetch`-двойником: клиент обязан быть тестируемым без
 * неё, и это не удобство тестов, а часть контракта конфигурации.
 */

import { makeClient } from './client.js';

import { describe, expect, it } from '@jest/globals';
import {
  defineFail,
  events,
  makeContract,
  multipart,
  query,
  upload,
} from '@nestling/contracts';
import { z } from 'zod';

const User = z.object({ id: z.string(), email: z.string() });

const EmailTaken = defineFail('CLIENT_EMAIL_TAKEN', {
  status: 'CONFLICT',
  message: 'Email already taken',
  details: z.object({ email: z.string() }),
});

const CreateUser = makeContract({
  name: 'client.users.create',
  kind: 'request',
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: z.object({
    email: z.string(),
    dryRun: z.boolean().optional(),
  }),
  output: User,
  errors: [EmailTaken],
});

const GetUser = makeContract({
  name: 'client.users.get',
  kind: 'request',
  http: 'GET /users/:id',
  input: z.object({ id: z.string(), expand: z.string().optional() }),
  output: User,
});

const ListUsers = makeContract({
  name: 'client.users.list',
  kind: 'request',
  http: 'GET /users',
  input: z.object({
    limit: z.number().optional(),
    tag: z.array(z.string()).optional(),
  }),
  output: z.array(User),
});

const DeleteUser = makeContract({
  name: 'client.users.delete',
  kind: 'command',
  http: 'DELETE /users/:id',
  input: z.object({ id: z.string() }),
});

const baseUrl = 'https://api.example.com';

/** Записывающий двойник `fetch`: последний запрос доступен тесту */
function stubFetch(
  reply: (request: { url: string; init: RequestInit }) => Response,
): {
  fetch: typeof globalThis.fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];

  const fake = ((input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return Promise.resolve(reply(call));
  }) as unknown as typeof globalThis.fetch;

  return { fetch: fake, calls };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('makeClient: форма API-объекта', () => {
  it('методы именует потребитель', () => {
    const api = makeClient(
      { createUser: CreateUser, getUser: GetUser },
      { baseUrl },
    );

    expect(Object.keys(api).sort()).toEqual(['createUser', 'getUser']);
    expect(typeof api.createUser).toBe('function');
  });
});

describe('makeClient: fail-fast создания', () => {
  it('контракт без http:', () => {
    const OnBus = makeContract({
      name: 'client.only.bus',
      kind: 'request',
      input: z.object({ id: z.string() }),
    });

    expect(() => makeClient({ claim: OnBus }, { baseUrl })).toThrow(
      /makeClient\({ claim: … }.*no 'http:' section/s,
    );
  });

  it('вид event', () => {
    const Placed = makeContract({
      name: 'client.orders.placed',
      kind: 'event',
      http: 'POST /events/placed',
      input: z.object({ id: z.string() }),
    });

    expect(() => makeClient({ placed: Placed }, { baseUrl })).toThrow(
      /makeClient\({ placed: … }.*is an 'event'.*'command'/s,
    );
  });

  it('потоковая форма io', () => {
    const Feed = makeContract({
      name: 'client.users.feed',
      kind: 'request',
      http: 'GET /feed',
      output: events(z.object({ kind: z.string() })),
    });

    expect(() => makeClient({ feed: Feed }, { baseUrl })).toThrow(
      /declares form 'events' in 'output'.*streaming client/s,
    );
  });

  it('multipart-форма io', () => {
    const Upload = makeContract({
      name: 'client.users.avatar',
      kind: 'command',
      http: 'POST /avatar',
      input: multipart({ files: { avatar: upload() } }),
    });

    expect(() => makeClient({ upload: Upload }, { baseUrl })).toThrow(
      /declares form 'multipart' in 'input'/,
    );
  });

  it('не-JSON тело', () => {
    const Raw = makeContract({
      name: 'client.users.raw',
      kind: 'request',
      http: 'GET /raw',
      output: 'text',
    });

    expect(() => makeClient({ raw: Raw }, { baseUrl })).toThrow(
      /declares 'text' in 'output'.*JSON only/s,
    );
  });

  it('неабсолютный baseUrl', () => {
    expect(() => makeClient({ getUser: GetUser }, { baseUrl: '/api' })).toThrow(
      /'baseUrl' must be an absolute URL/,
    );
  });
});

describe('makeClient: сборка запроса', () => {
  it('path-параметр уходит в путь, остальное — в тело', async () => {
    const stub = stubFetch(() => json(200, { id: '42', email: 'a@b.c' }));
    const api = makeClient(
      { getUser: GetUser },
      { baseUrl, fetch: stub.fetch },
    );

    await api.getUser({ id: '42' });

    expect(stub.calls[0].url).toBe('https://api.example.com/users/42');
    expect(stub.calls[0].init.method).toBe('GET');
    expect(stub.calls[0].init.body).toBeUndefined();
  });

  it('path-параметр экранируется', async () => {
    const stub = stubFetch(() => json(200, { id: 'a/b', email: 'a@b.c' }));
    const api = makeClient(
      { getUser: GetUser },
      { baseUrl, fetch: stub.fetch },
    );

    await api.getUser({ id: 'a/b c' });

    expect(stub.calls[0].url).toBe('https://api.example.com/users/a%2Fb%20c');
  });

  it('метод без тела кладёт остальное в query и не ставит Content-Type', async () => {
    const stub = stubFetch(() => json(200, []));
    const api = makeClient(
      { listUsers: ListUsers },
      { baseUrl, fetch: stub.fetch },
    );

    await api.listUsers({ limit: 10 });

    expect(stub.calls[0].url).toBe('https://api.example.com/users?limit=10');
    expect(stub.calls[0].init.body).toBeUndefined();
    expect(
      (stub.calls[0].init.headers as Record<string, string>)['content-type'],
    ).toBeUndefined();
  });

  it('помеченное поле уходит в query, остальное — в тело', async () => {
    const stub = stubFetch(() => json(201, { id: 'u-1', email: 'a@b.c' }));
    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: stub.fetch },
    );

    await api.createUser({ email: 'a@b.c', dryRun: true });

    expect(stub.calls[0].url).toBe('https://api.example.com/users?dryRun=true');
    expect(stub.calls[0].init.body).toBe('{"email":"a@b.c"}');
    expect(
      (stub.calls[0].init.headers as Record<string, string>)['content-type'],
    ).toBe('application/json');
  });

  it('baseUrl с хвостовым слэшем склеивается без удвоения', async () => {
    const stub = stubFetch(() => json(200, []));
    const api = makeClient(
      { listUsers: ListUsers },
      { baseUrl: 'https://api.example.com/', fetch: stub.fetch },
    );

    await api.listUsers({});

    expect(stub.calls[0].url).toBe('https://api.example.com/users');
  });

  it('отсутствующий path-параметр — ошибка вызова', async () => {
    const stub = stubFetch(() => json(200, {}));
    const api = makeClient(
      { getUser: GetUser },
      { baseUrl, fetch: stub.fetch },
    );

    await expect(api.getUser({ id: undefined as never })).rejects.toThrow(
      /path parameter ':id' is required/,
    );
    expect(stub.calls).toHaveLength(0);
  });
});

/** Вызов `listUsers` с произвольным payload'ом: возвращает собранный URL */
const listUsersUrl = async (
  payload: Record<string, unknown>,
): Promise<string | undefined> => {
  const stub = stubFetch(() => json(200, []));
  const api = makeClient(
    { listUsers: ListUsers },
    { baseUrl, fetch: stub.fetch },
  );
  await api.listUsers(payload as never);
  return stub.calls[0]?.url;
};

describe('makeClient: коерсия query', () => {
  it('массив даёт повторяющийся ключ', async () => {
    expect(await listUsersUrl({ tag: ['a', 'b'] })).toBe(
      'https://api.example.com/users?tag=a&tag=b',
    );
  });

  it('undefined и null не пишутся', async () => {
    expect(await listUsersUrl({ limit: undefined, tag: null })).toBe(
      'https://api.example.com/users',
    );
  });

  it('скаляры приводятся строкой', async () => {
    expect(await listUsersUrl({ limit: 0 })).toBe(
      'https://api.example.com/users?limit=0',
    );
  });

  it('объект в query — TypeError с именем поля, запрос не уходит', async () => {
    const stub = stubFetch(() => json(200, []));
    const api = makeClient(
      { listUsers: ListUsers },
      { baseUrl, fetch: stub.fetch },
    );

    await expect(
      api.listUsers({ limit: { from: 1 } as never }),
    ).rejects.toThrow(/query field 'limit' has no wire representation/);
    expect(stub.calls).toHaveLength(0);
  });

  it('вложенный массив — тоже TypeError', async () => {
    const stub = stubFetch(() => json(200, []));
    const api = makeClient(
      { listUsers: ListUsers },
      { baseUrl, fetch: stub.fetch },
    );

    await expect(api.listUsers({ tag: [['a']] as never })).rejects.toThrow(
      /query field 'tag' contains a value/,
    );
  });
});

describe('makeClient: разбор успеха', () => {
  it('валидный ответ даёт Ok со значением из схемы', async () => {
    const stub = stubFetch(() => json(201, { id: 'u-1', email: 'a@b.c' }));
    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: stub.fetch },
    );

    const result = await api.createUser({ email: 'a@b.c' });

    expect(result.isFail).toBe(false);
    expect(result).toMatchObject({
      status: 'CREATED',
      value: { id: 'u-1', email: 'a@b.c' },
    });
  });

  it('204 даёт Ok(NO_CONTENT, null)', async () => {
    const stub = stubFetch(() => new Response(null, { status: 204 }));
    const api = makeClient(
      { deleteUser: DeleteUser },
      { baseUrl, fetch: stub.fetch },
    );

    await expect(api.deleteUser({ id: '42' })).resolves.toBeUndefined();
  });

  it('ответ, не прошедший схему, даёт UNKNOWN с issue в cause', async () => {
    const stub = stubFetch(() => json(200, { id: 'u-1' }));
    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: stub.fetch },
    );

    const result = await api.createUser({ email: 'a@b.c' });

    expect(result).toMatchObject({ isFail: true, code: 'UNKNOWN' });
    expect((result as { cause?: unknown }).cause).toBeDefined();
  });

  it('validateOutput: false отдаёт тело как есть', async () => {
    const stub = stubFetch(() => json(200, { id: 'u-1' }));
    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: stub.fetch, validateOutput: false },
    );

    const result = await api.createUser({ email: 'a@b.c' });

    expect(result).toMatchObject({ isFail: false, value: { id: 'u-1' } });
  });
});

describe('makeClient: разбор отказа', () => {
  it('задекларированный отказ рематериализуется по коду', async () => {
    const stub = stubFetch(() =>
      json(409, {
        error: 'Email taken',
        code: 'CLIENT_EMAIL_TAKEN',
        details: { email: 'a@b.c' },
      }),
    );
    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: stub.fetch },
    );

    const result = await api.createUser({ email: 'a@b.c' });

    expect(EmailTaken.is(result)).toBe(true);
    expect(result).toMatchObject({
      status: 'CONFLICT',
      message: 'Email taken',
      details: { email: 'a@b.c' },
    });
  });

  it('статус берётся из определения, а не с провода', async () => {
    const stub = stubFetch(() =>
      json(500, {
        error: 'Email taken',
        code: 'CLIENT_EMAIL_TAKEN',
        details: { email: 'a@b.c' },
      }),
    );
    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: stub.fetch },
    );

    expect(await api.createUser({ email: 'a@b.c' })).toMatchObject({
      status: 'CONFLICT',
    });
  });

  it('незадекларированный код даёт UNKNOWN с телом в cause', async () => {
    const body = { error: 'nope', code: 'SOMETHING_ELSE' };
    const stub = stubFetch(() => json(418, body));
    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: stub.fetch },
    );

    const result = await api.createUser({ email: 'a@b.c' });

    expect(result).toMatchObject({ isFail: true, code: 'UNKNOWN' });
    expect((result as { cause?: unknown }).cause).toEqual(body);
  });

  it('несошедшиеся детали дают UNKNOWN, а не отказ с мусором', async () => {
    const stub = stubFetch(() =>
      json(409, {
        error: 'Email taken',
        code: 'CLIENT_EMAIL_TAKEN',
        details: { wrong: 1 },
      }),
    );
    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: stub.fetch },
    );

    const result = await api.createUser({ email: 'a@b.c' });

    expect(result).toMatchObject({ isFail: true, code: 'UNKNOWN' });
    expect(EmailTaken.is(result)).toBe(false);
  });

  it('сетевой сбой не бросает — возвращает UNKNOWN', async () => {
    const failing = (() =>
      Promise.reject(
        new Error('ECONNREFUSED'),
      )) as unknown as typeof globalThis.fetch;

    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: failing },
    );

    const result = await api.createUser({ email: 'a@b.c' });

    expect(result).toMatchObject({ isFail: true, code: 'UNKNOWN' });
    expect((result as { cause?: Error }).cause?.message).toBe('ECONNREFUSED');
  });

  it('не-JSON тело даёт UNKNOWN', async () => {
    const stub = stubFetch(
      () => new Response('<html>502</html>', { status: 502 }),
    );
    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: stub.fetch },
    );

    expect(await api.createUser({ email: 'a@b.c' })).toMatchObject({
      isFail: true,
      code: 'UNKNOWN',
    });
  });

  it('команда бросает отказ вместо возврата', async () => {
    const stub = stubFetch(() => json(404, { error: 'gone' }));
    const api = makeClient(
      { deleteUser: DeleteUser },
      { baseUrl, fetch: stub.fetch },
    );

    await expect(api.deleteUser({ id: '42' })).rejects.toMatchObject({
      isFail: true,
      code: 'UNKNOWN',
    });
  });
});

describe('makeClient: meta и конфигурация', () => {
  it('истёкший бюджет не идёт в сеть', async () => {
    const stub = stubFetch(() => json(200, { id: 'u-1', email: 'a@b.c' }));
    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: stub.fetch },
    );

    const result = await api.createUser(
      { email: 'a@b.c' },
      { deadline: new Date(Date.now() - 1000) },
    );

    expect(result).toMatchObject({
      isFail: true,
      code: 'DEADLINE_EXCEEDED',
      status: 'TIMEOUT',
    });
    expect(stub.calls).toHaveLength(0);
  });

  it('signal уезжает в запрос', async () => {
    const controller = new AbortController();
    const stub = stubFetch(() => json(200, { id: 'u-1', email: 'a@b.c' }));
    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: stub.fetch },
    );

    await api.createUser({ email: 'a@b.c' }, { signal: controller.signal });

    expect(stub.calls[0].init.signal).toBe(controller.signal);
  });

  it('отмена по signal даёт UNKNOWN, а не исключение', async () => {
    const aborting = (() =>
      Promise.reject(
        Object.assign(new Error('This operation was aborted'), {
          name: 'AbortError',
        }),
      )) as unknown as typeof globalThis.fetch;

    const api = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: aborting },
    );

    expect(await api.createUser({ email: 'a@b.c' })).toMatchObject({
      isFail: true,
      code: 'UNKNOWN',
    });
  });

  it('ambient-заголовки записью и функцией', async () => {
    const stub = stubFetch(() => json(200, { id: 'u-1', email: 'a@b.c' }));

    const withRecord = makeClient(
      { createUser: CreateUser },
      { baseUrl, fetch: stub.fetch, headers: { 'x-trace': 'static' } },
    );
    await withRecord.createUser({ email: 'a@b.c' });

    let issued = 0;
    const withFunction = makeClient(
      { createUser: CreateUser },
      {
        baseUrl,
        fetch: stub.fetch,
        headers: () => {
          issued += 1;
          return Promise.resolve({ authorization: `Bearer t-${issued}` });
        },
      },
    );
    await withFunction.createUser({ email: 'a@b.c' });
    await withFunction.createUser({ email: 'c@d.e' });

    expect(
      (stub.calls[0].init.headers as Record<string, string>)['x-trace'],
    ).toBe('static');
    expect(
      (stub.calls[1].init.headers as Record<string, string>).authorization,
    ).toBe('Bearer t-1');
    expect(
      (stub.calls[2].init.headers as Record<string, string>).authorization,
    ).toBe('Bearer t-2');
  });
});
