/**
 * Интеграционные тесты HTTP-транспорта на реальном node:http-сервере.
 *
 * Покрывают transport-hardening: безопасность 500-ответов, классификация
 * ошибок входа (400/413), лимиты размера тела и graceful close.
 */

import { getEventListeners } from 'node:events';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { type AddressInfo, connect } from 'node:net';

import { query } from './binding.js';
import { httpEndpoint } from './helpers.js';
import { HttpTransport } from './transport.js';

import type { Schema } from '@common/misc';
import type { FilePart, PreUnitFn } from '@nestling/pipeline';
import {
  Fail,
  makePipeline,
  Ok,
  stream,
  validate,
  withFiles,
} from '@nestling/pipeline';
import { z } from 'zod';

/**
 * Поднимает транспорт на эфемерном порту, возвращает базовый URL.
 */
async function listen(transport: HttpTransport): Promise<string> {
  await transport.listen(0, '127.0.0.1');
  const server = (transport as unknown as { server: Server }).server;
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

/**
 * Запрос с телом при любом методе (fetch не даёт послать тело с GET).
 *
 * Нужен, чтобы проверить: тело, которое карта не требует, транспорт не
 * буферизует — иначе лимит `maxBodySize` отдал бы 413.
 */
function requestWithBody(
  baseUrl: string,
  options: { method: string; path: string; body: string },
): Promise<{ status: number; body: string }> {
  const url = new URL(options.path, baseUrl);

  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: options.method,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(options.body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );

    req.on('error', reject);
    req.end(options.body);
  });
}

function getServer(transport: HttpTransport): Server {
  return (transport as unknown as { server: Server }).server;
}

describe('HttpTransport — error response safety', () => {
  let transport: HttpTransport;
  let exposed: HttpTransport;
  let baseUrl: string;
  let exposedUrl: string;

  beforeAll(async () => {
    transport = new HttpTransport();
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/boom',
        pipeline: makePipeline(),
        handle: () => {
          throw new Error('db password invalid');
        },
      }),
    );
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/fail',
        pipeline: makePipeline(),
        handle: () => {
          throw Fail.badRequest('Email already taken', { field: 'email' });
        },
      }),
    );
    baseUrl = await listen(transport);

    exposed = new HttpTransport({ exposeErrorDetails: true });
    exposed.route(
      httpEndpoint({
        method: 'POST',
        path: '/boom',
        pipeline: makePipeline(),
        handle: () => {
          throw new Error('boom');
        },
      }),
    );
    exposedUrl = await listen(exposed);
  });

  afterAll(async () => {
    await transport.close();
    await exposed.close();
  });

  it('unhandled error → generic 500 без деталей', async () => {
    const response = await fetch(`${baseUrl}/boom`, { method: 'POST' });
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('db password');
    expect(body.stack).toBeUndefined();
  });

  it('unhandled error c exposeErrorDetails → message и stack', async () => {
    const response = await fetch(`${exposedUrl}/boom`, { method: 'POST' });
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe('boom');
    expect(typeof body.stack).toBe('string');
  });

  it('Fail.badRequest → 400 с message и details', async () => {
    const response = await fetch(`${baseUrl}/fail`, { method: 'POST' });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toEqual({
      error: 'Email already taken',
      details: { field: 'email' },
    });
  });
});

/** Схема с async-refinement: `~standard.validate` возвращает Promise. */
const asyncSchema = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () => Promise.resolve({ value: { name: 'Alice' } }),
  },
} as unknown as Schema;

/** Объект, не реализующий Standard Schema v1 (валидатор старой версии). */
const notASchema = {
  parse: (value: unknown) => value,
} as unknown as Schema;

describe('HttpTransport — request validation errors', () => {
  let transport: HttpTransport;
  let baseUrl: string;

  beforeAll(async () => {
    transport = new HttpTransport();

    // JSON endpoint с pipeline validate()
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/json',
        input: z.object({ name: z.string() }),
        pipeline: makePipeline().pre(validate()),
        handle: (payload: { name: string }) => new Ok({ ok: payload.name }),
      }),
    );

    // Fallback без pipeline — валидация в транспорте
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/fallback',
        input: z.object({ name: z.string() }),
        handle: (payload: { name: string }) => ({ ok: payload.name }),
      }),
    );

    // Схема с async-refinement: ошибка конфигурации приложения, не входа
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/async-schema',
        input: asyncSchema,
        pipeline: makePipeline().pre(validate()),
        handle: () => new Ok({ ok: true }),
      }),
    );

    // Объект, не реализующий Standard Schema: тоже не ошибка входа
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/not-a-schema',
        input: notASchema,
        pipeline: makePipeline().pre(validate()),
        handle: () => new Ok({ ok: true }),
      }),
    );

    baseUrl = await listen(transport);
  });

  afterAll(async () => {
    await transport.close();
  });

  it('битый JSON → 400 Invalid JSON body без stack', async () => {
    const response = await fetch(`${baseUrl}/json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name": "Al',
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe('Invalid JSON body');
    expect(body.stack).toBeUndefined();
  });

  it('невалидный payload в fallback-ветке → 400 с деталями', async () => {
    const response = await fetch(`${baseUrl}/fallback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('details — стандартные issues { message, path } без вендорских полей', async () => {
    for (const path of ['/json', '/fallback']) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 42 }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.details).toEqual([
        { message: expect.any(String), path: ['name'] },
      ]);
      expect(body.details[0]).not.toHaveProperty('code');
      expect(body.details[0]).not.toHaveProperty('expected');
      expect(body.details[0]).not.toHaveProperty('received');
    }
  });

  it('async-схема → 500, а не 400', async () => {
    const response = await fetch(`${baseUrl}/async-schema`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });

  it('объект вместо схемы → 500, а не 400', async () => {
    const response = await fetch(`${baseUrl}/not-a-schema`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });

  it('валидный JSON → 200', async () => {
    const response = await fetch(`${baseUrl}/json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: 'Alice' });
  });
});

describe('HttpTransport — strict-приём по bind-карте', () => {
  let transport: HttpTransport;
  let baseUrl: string;
  let seenRawBody: Uint8Array | undefined;

  /** Слой проверки подписи: объявляет требование к стартовому контексту */
  const captureRawBody: PreUnitFn<{ rawBody: Uint8Array }, undefined> = (
    ctx,
  ) => {
    seenRawBody = ctx.input.rawBody;
  };

  beforeAll(async () => {
    transport = new HttpTransport();

    // POST: поля по канону — в теле
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/users',
        input: z.object({ name: z.string() }),
        pipeline: makePipeline().pre(validate()),
        handle: (payload: { name: string }) => new Ok(payload),
      }),
    );

    // PATCH: одноимённые path-параметр и поле тела
    transport.route(
      httpEndpoint({
        method: 'PATCH',
        path: '/users/:id',
        input: z.object({ id: z.string(), name: z.string() }),
        pipeline: makePipeline().pre(validate()),
        handle: (payload: { id: string; name: string }) => new Ok(payload),
      }),
    );

    // GET: повтор ключа даёт массив
    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/tags',
        input: z.object({ tag: z.array(z.string()) }),
        pipeline: makePipeline().pre(validate()),
        handle: (payload: { tag: string[] }) => new Ok(payload),
      }),
    );

    // GET: пометка multiple даёт массив и при одном вхождении
    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/multi',
        input: z.object({ tag: z.array(z.string()) }),
        bind: { tag: query({ multiple: true }) },
        pipeline: makePipeline().pre(validate()),
        handle: (payload: { tag: string[] }) => new Ok(payload),
      }),
    );

    // POST: поле вытянуто пометкой из тела в query
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/marked',
        input: z.object({ name: z.string(), dryRun: z.string().optional() }),
        bind: { dryRun: query() },
        pipeline: makePipeline().pre(validate()),
        handle: (payload: { name: string; dryRun?: string }) => new Ok(payload),
      }),
    );

    // Multipart с path-параметром
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/users/:id/avatar',
        input: withFiles(z.object({ id: z.string() })),
        pipeline: makePipeline(),
        handle: (payload: { data: { id: string }; files: FilePart[] }) =>
          new Ok({
            id: payload.data.id,
            files: payload.files.map((file) => file.field),
          }),
      }),
    );

    // Webhook: сырые байты в типизированном стартовом контексте
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/hooks/stripe',
        input: z.object({ event: z.string() }),
        rawBody: true,
        pipeline: makePipeline<{ rawBody: Uint8Array }>()
          .pre(captureRawBody)
          .pre(validate()),
        handle: (payload: { event: string }) => new Ok(payload),
      }),
    );

    baseUrl = await listen(transport);
  });

  afterAll(async () => {
    await transport.close();
  });

  it('поле, присланное не в своё место, отбрасывается → 400 с именем поля', async () => {
    const response = await fetch(`${baseUrl}/users?name=Alice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toEqual([
      { message: expect.any(String), path: ['name'] },
    ]);
    // Конфликта источников больше не существует
    expect(JSON.stringify(body)).not.toContain('Duplicate key');
  });

  it('одноимённые path-параметр и поле тела → значение из пути', async () => {
    const response = await fetch(`${baseUrl}/users/42`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '7', name: 'Alice' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: '42', name: 'Alice' });
  });

  it('повторный query-ключ становится массивом', async () => {
    const response = await fetch(`${baseUrl}/tags?tag=a&tag=b`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tag: ['a', 'b'] });
  });

  it('query({ multiple: true }) даёт массив и при одном вхождении', async () => {
    const response = await fetch(`${baseUrl}/multi?tag=a`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tag: ['a'] });
  });

  it('помеченное поле читается из query, остальные — из тела', async () => {
    const response = await fetch(`${baseUrl}/marked?dryRun=yes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', dryRun: 'no' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'Alice', dryRun: 'yes' });
  });

  it('multipart с path-параметром: id в data до валидации схемой', async () => {
    const form = new FormData();
    form.append('avatar', new Blob([Buffer.from('png')]), 'a.png');

    const response = await fetch(`${baseUrl}/users/7/avatar`, {
      method: 'POST',
      body: form,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: '7', files: ['avatar'] });
  });

  it('webhook: слой видит байты, хендлер — разобранный payload', async () => {
    seenRawBody = undefined;
    const payload = JSON.stringify({ event: 'charge.succeeded' });

    const response = await fetch(`${baseUrl}/hooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ event: 'charge.succeeded' });

    const seen: Uint8Array | undefined = seenRawBody;
    expect(seen).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(seen ?? new Uint8Array()).toString()).toBe(payload);
  });
});

describe('HttpTransport — тело читается только по требованию карты', () => {
  let transport: HttpTransport;
  let baseUrl: string;

  beforeAll(async () => {
    // Лимит меньше присылаемого тела: если транспорт его прочитает — 413
    transport = new HttpTransport({ maxBodySize: 100 });
    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/search',
        input: z.object({ q: z.string() }),
        pipeline: makePipeline().pre(validate()),
        handle: (payload: { q: string }) => new Ok(payload),
      }),
    );
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/hooks',
        input: z.object({ event: z.string() }),
        rawBody: true,
        pipeline: makePipeline<{ rawBody: Uint8Array }>().pre(validate()),
        handle: (payload: { event: string }) => new Ok(payload),
      }),
    );
    baseUrl = await listen(transport);
  });

  afterAll(async () => {
    await transport.close();
  });

  it('тело у GET не буферизуется: запрос обрабатывается по query', async () => {
    const { status, body } = await requestWithBody(baseUrl, {
      method: 'GET',
      path: '/search?q=Alice',
      body: 'x'.repeat(500),
    });

    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ q: 'Alice' });
  });

  it('лимит тела действует и для сырых байтов → 413', async () => {
    const response = await fetch(`${baseUrl}/hooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'x'.repeat(500) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Payload too large' });
  });
});

describe('HttpTransport — body size limits', () => {
  let small: HttpTransport;
  let unlimited: HttpTransport;
  let smallUrl: string;
  let unlimitedUrl: string;

  beforeAll(async () => {
    small = new HttpTransport({ maxBodySize: 100 });
    small.route(
      httpEndpoint({
        method: 'POST',
        path: '/json',
        input: z.object({ name: z.string() }),
        pipeline: makePipeline().pre(validate()),
        handle: (payload: { name: string }) => new Ok({ ok: payload.name }),
      }),
    );
    small.route(
      httpEndpoint({
        method: 'POST',
        path: '/stream',
        input: stream(z.object({ n: z.number() })),
        // Без pipeline: ошибка чанка всплывает в верхний catch → 413
        handle: async (payload: AsyncIterable<unknown>) => {
          let count = 0;
          for await (const item of payload) {
            count += item ? 1 : 0;
          }
          return { count };
        },
      }),
    );
    smallUrl = await listen(small);

    unlimited = new HttpTransport({ maxBodySize: 0 });
    unlimited.route(
      httpEndpoint({
        method: 'POST',
        path: '/json',
        input: z.object({ name: z.string() }),
        pipeline: makePipeline().pre(validate()),
        handle: (payload: { name: string }) =>
          new Ok({ length: payload.name.length }),
      }),
    );
    unlimitedUrl = await listen(unlimited);
  });

  afterAll(async () => {
    await small.close();
    await unlimited.close();
  });

  it('JSON больше лимита → 413', async () => {
    const response = await fetch(`${smallUrl}/json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(500) }),
    });
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error).toBe('Payload too large');
  });

  it('maxBodySize: 0 → без лимита', async () => {
    const response = await fetch(`${unlimitedUrl}/json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(10_000) }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ length: 10_000 });
  });

  it('NDJSON-строка больше лимита → 413', async () => {
    const response = await fetch(`${smallUrl}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-ndjson' },
      body: 'x'.repeat(300),
    });
    expect(response.status).toBe(413);
  });
});

describe('HttpTransport — timeouts and graceful close', () => {
  it('таймауты применяются к серверу', async () => {
    const transport = new HttpTransport({
      requestTimeout: 5000,
      headersTimeout: 2000,
      keepAliveTimeout: 1000,
    });
    await listen(transport);
    const server = getServer(transport);

    expect(server.requestTimeout).toBe(5000);
    expect(server.headersTimeout).toBe(2000);
    expect(server.keepAliveTimeout).toBe(1000);

    await transport.close();
  });

  it('close() с идущим keep-alive завершается быстро', async () => {
    const transport = new HttpTransport({ keepAliveTimeout: 60_000 });
    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/ping',
        pipeline: makePipeline(),
        handle: () => new Ok({ pong: true }),
      }),
    );
    const baseUrl = await listen(transport);
    const port = Number(new URL(baseUrl).port);

    // Открываем keep-alive соединение через сырой сокет и держим его idle.
    const socket = connect(port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => {
        socket.write(
          'GET /ping HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n',
        );
      });
      socket.once('data', () => resolve());
      socket.on('error', reject);
    });

    const started = process.hrtime.bigint();
    await transport.close();
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    // Не ждём keepAliveTimeout (60s) — closeIdleConnections рубит сразу.
    expect(elapsedMs).toBeLessThan(2000);

    socket.destroy();
  });

  it('close() с зависшим запросом завершается по closeTimeout', async () => {
    const transport = new HttpTransport();
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/hang',
        pipeline: makePipeline(),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        handle: () => new Promise<never>(() => {}), // никогда не резолвится
      }),
    );
    const baseUrl = await listen(transport);

    // Запускаем запрос, который зависнет в handler'е.
    const pending = fetch(`${baseUrl}/hang`, { method: 'POST' }).catch(
      () => null,
    );
    // Даём запросу дойти до сервера.
    await new Promise((r) => setTimeout(r, 100));

    const started = process.hrtime.bigint();
    await transport.close({ timeout: 300 });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    expect(elapsedMs).toBeGreaterThanOrEqual(250);
    expect(elapsedMs).toBeLessThan(2000);

    await pending;
  });
});

/**
 * Хендлер, который стартует и ждёт взведения meta.signal.
 * Возвращает промисы «запрос дошёл до хендлера» и «сигнал взведён».
 */
function makeAwaitingHandler() {
  let onStarted!: () => void;
  let onAborted!: (reason: unknown) => void;
  const started = new Promise<void>((r) => (onStarted = r));
  const aborted = new Promise<unknown>((r) => (onAborted = r));

  const handle = (_payload: unknown, meta: { signal: AbortSignal }) => {
    onStarted();
    meta.signal.addEventListener('abort', () => onAborted(meta.signal.reason), {
      once: true,
    });
    return aborted.then(() => new Ok({ done: true }));
  };

  return { handle, started, aborted };
}

describe('HttpTransport — request cancellation (meta.signal)', () => {
  it('дисконнект клиента взводит meta.signal', async () => {
    const transport = new HttpTransport();
    const { handle, started, aborted } = makeAwaitingHandler();
    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/slow',
        pipeline: makePipeline(),
        handle,
      }),
    );
    const baseUrl = await listen(transport);

    const clientAbort = new AbortController();
    const pending = fetch(`${baseUrl}/slow`, {
      signal: clientAbort.signal,
    }).catch(() => null);

    await started;
    clientAbort.abort();

    const reason = await aborted;
    expect(reason).toBeInstanceOf(Error);
    expect((reason as Error).message).toBe('client disconnected');

    await pending;
    await transport.close();
  });

  it('штатное завершение (keep-alive) не взводит сигнал', async () => {
    const transport = new HttpTransport();
    let captured: AbortSignal | undefined;
    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/ping',
        pipeline: makePipeline(),
        handle: (_payload: unknown, meta: { signal: AbortSignal }) => {
          captured = meta.signal;
          return new Ok({ pong: true });
        },
      }),
    );
    const baseUrl = await listen(transport);

    const response = await fetch(`${baseUrl}/ping`, {
      headers: { connection: 'keep-alive' },
    });
    expect(response.status).toBe(200);
    await response.json();

    // Даём событию 'close' (если бы оно трактовалось как дисконнект) дойти.
    await new Promise((r) => setTimeout(r, 50));
    expect(captured).toBeDefined();
    expect(captured?.aborted).toBe(false);

    await transport.close();
  });

  it('close(): кооперативный хендлер завершается заметно раньше closeTimeout', async () => {
    const transport = new HttpTransport({ closeTimeout: 5000 });
    const { handle, started, aborted } = makeAwaitingHandler();
    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/graceful',
        pipeline: makePipeline(),
        handle,
      }),
    );
    const baseUrl = await listen(transport);

    const pending = fetch(`${baseUrl}/graceful`, { method: 'POST' }).catch(
      () => null,
    );
    await started;

    const startedAt = process.hrtime.bigint();
    await transport.close();
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    // Дренаж по кооперативному завершению, а не force-close по таймауту.
    expect(elapsedMs).toBeLessThan(2000);

    const reason = await aborted;
    expect((reason as Error).message).toBe('transport closing');

    await pending;
  });

  it('fallback-endpoint без pipeline получает meta.signal при дисконнекте', async () => {
    const transport = new HttpTransport();
    const { handle, started, aborted } = makeAwaitingHandler();
    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/raw',
        handle: (_payload: unknown, meta: { signal: AbortSignal }) => {
          const result = handle(_payload, meta);
          return result.then((ok) => ok.value);
        },
      }),
    );
    const baseUrl = await listen(transport);

    const clientAbort = new AbortController();
    const pending = fetch(`${baseUrl}/raw`, {
      signal: clientAbort.signal,
    }).catch(() => null);

    await started;
    clientAbort.abort();

    const reason = await aborted;
    expect((reason as Error).message).toBe('client disconnected');

    await pending;
    await transport.close();
  });

  it('серия запросов не накапливает слушателей transport-level сигнала', async () => {
    const transport = new HttpTransport();
    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/ping',
        pipeline: makePipeline(),
        handle: () => new Ok({ pong: true }),
      }),
    );
    const baseUrl = await listen(transport);

    const closeSignal = (
      transport as unknown as { closeController: AbortController }
    ).closeController.signal;

    // Первый запрос — прогрев (базовый уровень внутренних слушателей).
    const warmup = await fetch(`${baseUrl}/ping`);
    await warmup.json();
    const baseline = getEventListeners(closeSignal, 'abort').length;

    for (let i = 0; i < 20; i++) {
      const response = await fetch(`${baseUrl}/ping`);
      await response.json();
    }

    const after = getEventListeners(closeSignal, 'abort').length;
    expect(after).toBeLessThanOrEqual(baseline);

    await transport.close();
  });
});
