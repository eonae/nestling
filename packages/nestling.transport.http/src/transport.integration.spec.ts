/**
 * Интеграционные тесты HTTP-транспорта на реальном node:http-сервере.
 *
 * Покрывают transport-hardening: безопасность 500-ответов, классификация
 * ошибок входа (400/413), лимиты размера тела и graceful close.
 */

import { getEventListeners } from 'node:events';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { connect } from 'node:net';

import { query } from './binding.js';
import { httpEndpoint } from './helpers.js';
import type { HttpTransportOptions } from './transport.js';
import { HttpTransport } from './transport.js';

import type { Schema } from '@common/misc';
import type { FilePart, PreUnitFn } from '@nestling/pipeline';
import {
  Fail,
  makeFail,
  makePipeline,
  multipart,
  Ok,
  PayloadTooLarge,
  stream,
  Timeout,
  upload,
} from '@nestling/pipeline';
import type { ExecutableDeclaration } from '@nestling/transport';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

/**
 * Транспорт для теста: эфемерный порт и loopback-хост.
 *
 * Аргументов у `serve` кроме `dispatch` и `signal` нет, поэтому адрес
 * задаётся опциями, а фактический порт читается через `address()`.
 */
function makeTransport(options: HttpTransportOptions = {}): HttpTransport {
  return new HttpTransport({ port: 0, host: '127.0.0.1', ...options });
}

/**
 * Декларации, накопленные тестом до запуска транспорта: он получает их
 * одним `dispatch` в `serve`, а не по одной.
 */
const pending = new WeakMap<HttpTransport, ExecutableDeclaration[]>();

function routesOf(transport: HttpTransport): ExecutableDeclaration[] {
  const known = pending.get(transport);
  if (known) {
    return known;
  }

  const created: ExecutableDeclaration[] = [];
  pending.set(transport, created);

  return created;
}

/** Контроллеры `serve`: их взвод — второй канал остановки рядом с close() */
const controllers = new WeakMap<HttpTransport, AbortController>();

/**
 * Поднимает транспорт на эфемерном порту, возвращает базовый URL.
 */
async function listen(transport: HttpTransport): Promise<string> {
  const controller = new AbortController();
  controllers.set(transport, controller);

  await transport.serve(makeDispatch(routesOf(transport)), controller.signal);

  const address = transport.address();
  if (!address) {
    throw new Error('transport did not report an address after serve()');
  }

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

/** Доменные отказы фикстур: канон — определение + `errors:` декларации */
const EmailTaken = makeFail('conflict:email_taken', {
  message: 'Email already taken',
  details: z.object({ field: z.string() }),
});

const RateLimited = makeFail('too_many_requests:rate_limited', {
  message: 'Too many requests',
});

const UpstreamTimeout = makeFail('timeout:upstream_timeout', {
  message: 'Upstream did not answer in time',
});

/** Заглушка диагностики: дефолтный console.error шумит в выводе тестов */
const silent = { onUnknownFail: (): void => undefined };

describe('HttpTransport — error response safety', () => {
  let transport: HttpTransport;
  let exposed: HttpTransport;
  let baseUrl: string;
  let exposedUrl: string;

  beforeAll(async () => {
    transport = makeTransport(silent);
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/boom',
        pipeline: makePipeline(),
        handler: () => {
          throw new Error('db password invalid');
        },
      }),
    );
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/fail',
        pipeline: makePipeline(),
        errors: [EmailTaken],
        handler: () => {
          throw EmailTaken({ field: 'email' });
        },
      }),
    );
    // Тот же отказ, но незадекларированный: проверка границы снимет его.
    // Категория `conflict` — не код ядра, иначе анонимный отказ прошёл бы
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/undeclared',
        pipeline: makePipeline(),
        handler: () => {
          throw Fail.conflict('Email already taken', { field: 'email' });
        },
      }),
    );
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/rate-limited',
        pipeline: makePipeline(),
        errors: [RateLimited],
        handler: () => {
          throw RateLimited();
        },
      }),
    );
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/timeout',
        pipeline: makePipeline(),
        errors: [UpstreamTimeout],
        handler: () => {
          throw UpstreamTimeout();
        },
      }),
    );
    baseUrl = await listen(transport);

    exposed = makeTransport({ exposeErrorDetails: true, ...silent });
    routesOf(exposed).push(
      httpEndpoint({
        method: 'POST',
        path: '/boom',
        pipeline: makePipeline(),
        handler: () => {
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
    expect(body).toEqual({
      error: 'Internal server error',
      code: 'internal_error',
    });
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

  it('задекларированный отказ → свой статус, код и детали', async () => {
    const response = await fetch(`${baseUrl}/fail`, { method: 'POST' });
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body).toEqual({
      error: 'Email already taken',
      code: 'conflict:email_taken',
      details: { field: 'email' },
    });
  });

  it('незадекларированный отказ → 500 internal_error, оригинал не раскрыт', async () => {
    const response = await fetch(`${baseUrl}/undeclared`, { method: 'POST' });
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body).toEqual({
      error: 'Internal server error',
      code: 'internal_error',
    });
    expect(JSON.stringify(body)).not.toContain('Email already taken');
  });

  it('новые статусы словаря передаются в HTTP-ответ: 429 и 504', async () => {
    const limited = await fetch(`${baseUrl}/rate-limited`, { method: 'POST' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      code: 'too_many_requests:rate_limited',
    });

    const timeout = await fetch(`${baseUrl}/timeout`, { method: 'POST' });
    expect(timeout.status).toBe(504);
    expect(await timeout.json()).toMatchObject({
      code: 'timeout:upstream_timeout',
    });
  });

  it('хук получает оригинал снятого отказа', async () => {
    const seen: unknown[] = [];
    const hooked = makeTransport({
      onUnknownFail: (info) => seen.push(info.error),
    });
    routesOf(hooked).push(
      httpEndpoint({
        method: 'POST',
        path: '/undeclared',
        pipeline: makePipeline(),
        handler: () => {
          throw Fail.notFound('order 42');
        },
      }),
    );
    const url = await listen(hooked);

    try {
      const response = await fetch(`${url}/undeclared`, { method: 'POST' });
      expect(response.status).toBe(500);
      expect(seen).toHaveLength(1);
      expect((seen[0] as Error).message).toBe('order 42');
    } finally {
      await hooked.close();
    }
  });
});

const OrderNotFound = makeFail('not_found:order', {
  message: 'Order not found',
});

describe('HttpTransport — категория отказа и заголовки Ok', () => {
  let transport: HttpTransport;
  let baseUrl: string;

  beforeAll(async () => {
    transport = makeTransport(silent);
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/orders/:id',
        input: z.object({ id: z.string() }),
        output: z.object({ id: z.string() }),
        errors: [OrderNotFound],
        handler: async () => OrderNotFound(),
      }),
    );
    // Отказы ядра проходят границу без объявления в `errors:`
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/too-large',
        pipeline: makePipeline(),
        handler: () => {
          throw PayloadTooLarge({ limit: 10 });
        },
      }),
    );
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/slow',
        pipeline: makePipeline(),
        handler: () => {
          throw Timeout();
        },
      }),
    );
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/orders',
        output: z.object({ id: z.string() }),
        handler: async () =>
          Ok.created(
            { id: '42' },
            {
              Location: '/orders/42',
              'content-type': 'application/vnd.orders+json',
            },
          ),
      }),
    );
    baseUrl = await listen(transport);
  });

  afterAll(async () => {
    await transport.close();
  });

  it('категория отказа переводится в HTTP-код: not_found → 404', async () => {
    const response = await fetch(`${baseUrl}/orders/1`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Order not found',
      code: 'not_found:order',
    });
  });

  it('отказы ядра доходят до клиента: 413 и 504 без объявления', async () => {
    const tooLarge = await fetch(`${baseUrl}/too-large`, { method: 'POST' });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({
      code: 'payload_too_large',
      details: { limit: 10 },
    });

    const slow = await fetch(`${baseUrl}/slow`, { method: 'POST' });
    expect(slow.status).toBe(504);
    expect(await slow.json()).toMatchObject({ code: 'timeout' });
  });

  it('заголовки Ok пишутся в ответ после заголовков формы', async () => {
    const response = await fetch(`${baseUrl}/orders`, { method: 'POST' });

    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBe('/orders/42');
    // Заголовок хендлера перекрывает заголовок, который ставит форма
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.orders+json',
    );
    expect(await response.json()).toEqual({ id: '42' });
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
    transport = makeTransport(silent);

    // JSON endpoint с пайплайном: проверку входа делает рантайм
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/json',
        input: z.object({ name: z.string() }),
        handler: (payload: { name: string }) => new Ok({ ok: payload.name }),
      }),
    );

    // Endpoint без пайплайна: тот же рантайм с пустым пайплайном
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/fallback',
        input: z.object({ name: z.string() }),
        handler: (payload: { name: string }) => ({ ok: payload.name }),
      }),
    );

    // Схема с async-refinement: ошибка конфигурации приложения, не входа
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/async-schema',
        input: asyncSchema,
        handler: () => new Ok({ ok: true }),
      }),
    );

    // Та же ошибка конфигурации у endpoint'а без пайплайна
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/async-schema-bare',
        input: asyncSchema,
        handler: () => new Ok({ ok: true }),
      }),
    );

    // Объект, не реализующий Standard Schema: тоже не ошибка входа
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/not-a-schema',
        input: notASchema,
        handler: () => new Ok({ ok: true }),
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
    expect(body.error).toBe('Bad request');
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
      // Kernel-код проставляется на обоих путях: пайплайн и fallback
      expect(body.code).toBe('bad_request');
    }
  });

  it('async-схема → 500, а не 400', async () => {
    const response = await fetch(`${baseUrl}/async-schema`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Internal server error',
      code: 'internal_error',
    });
  });

  it('async-схема без пайплайна → 500: путь исполнения один', async () => {
    const response = await fetch(`${baseUrl}/async-schema-bare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Internal server error',
      code: 'internal_error',
    });
  });

  it('объект вместо схемы → 500, а не 400', async () => {
    const response = await fetch(`${baseUrl}/not-a-schema`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Internal server error',
      code: 'internal_error',
    });
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
    transport = makeTransport();

    // POST: поля по канону — в теле
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/users',
        input: z.object({ name: z.string() }),
        handler: (payload: { name: string }) => new Ok(payload),
      }),
    );

    // PATCH: одноимённые path-параметр и поле тела
    routesOf(transport).push(
      httpEndpoint({
        method: 'PATCH',
        path: '/users/:id',
        input: z.object({ id: z.string(), name: z.string() }),
        handler: (payload: { id: string; name: string }) => new Ok(payload),
      }),
    );

    // GET: повтор ключа даёт массив
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/tags',
        input: z.object({ tag: z.array(z.string()) }),
        handler: (payload: { tag: string[] }) => new Ok(payload),
      }),
    );

    // GET: пометка multiple даёт массив и при одном вхождении
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/multi',
        input: z.object({ tag: z.array(z.string()) }),
        bind: { tag: query({ multiple: true }) },
        handler: (payload: { tag: string[] }) => new Ok(payload),
      }),
    );

    // POST: поле вытянуто пометкой из тела в query
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/marked',
        input: z.object({ name: z.string(), dryRun: z.string().optional() }),
        bind: { dryRun: query() },
        handler: (payload: { name: string; dryRun?: string }) =>
          new Ok(payload),
      }),
    );

    // Multipart с path-параметром
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/users/:id/avatar',
        input: multipart({
          fields: z.object({ id: z.string() }),
          files: { avatar: upload() },
        }),
        pipeline: makePipeline(),
        handler: (payload: {
          fields: { id: string };
          files: { avatar: FilePart };
        }) =>
          new Ok({
            id: payload.fields.id,
            files: [payload.files.avatar.field],
          }),
      }),
    );

    // Поля multipart проверяет рантайм: у транспорта своей ветки нет
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/uploads',
        input: multipart({
          fields: z.object({ title: z.string().min(1) }),
          files: { report: upload() },
        }),
        handler: (payload: {
          fields: { title: string };
          files: { report: FilePart };
        }) =>
          new Ok({
            title: payload.fields.title,
            file: payload.files.report.field,
          }),
      }),
    );

    // Webhook: сырые байты в типизированном стартовом контексте
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/hooks/stripe',
        input: z.object({ event: z.string() }),
        rawBody: true,
        pipeline: makePipeline<{ rawBody: Uint8Array }>().pre(captureRawBody),
        handler: (payload: { event: string }) => new Ok(payload),
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
    expect(body.error).toBe('Bad request');
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

  it('невалидные поля multipart → 400, файловый поток дочитан', async () => {
    const form = new FormData();
    form.append('title', '');
    form.append('report', new Blob([Buffer.from('x'.repeat(2048))]), 'r.bin');

    const response = await fetch(`${baseUrl}/uploads`, {
      method: 'POST',
      body: form,
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('bad_request');
    expect(body.details).toEqual([
      { message: expect.any(String), path: ['title'] },
    ]);

    // Соединение закрылось штатно: следующий запрос обслуживается
    const next = new FormData();
    next.append('title', 'Report');
    next.append('report', new Blob([Buffer.from('x')]), 'r.bin');
    const ok = await fetch(`${baseUrl}/uploads`, {
      method: 'POST',
      body: next,
    });

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ title: 'Report', file: 'report' });
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
    transport = makeTransport({ maxBodySize: 100 });
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/search',
        input: z.object({ q: z.string() }),
        handler: (payload: { q: string }) => new Ok(payload),
      }),
    );
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/hooks',
        input: z.object({ event: z.string() }),
        rawBody: true,
        pipeline: makePipeline<{ rawBody: Uint8Array }>(),
        handler: (payload: { event: string }) => new Ok(payload),
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
    expect(await response.json()).toEqual({
      error: 'Payload too large',
      code: 'payload_too_large',
      details: { limit: 100 },
    });
  });
});

describe('HttpTransport — body size limits', () => {
  let small: HttpTransport;
  let unlimited: HttpTransport;
  let smallUrl: string;
  let unlimitedUrl: string;

  beforeAll(async () => {
    small = makeTransport({ maxBodySize: 100 });
    routesOf(small).push(
      httpEndpoint({
        method: 'POST',
        path: '/json',
        input: z.object({ name: z.string() }),
        handler: (payload: { name: string }) => new Ok({ ok: payload.name }),
      }),
    );
    routesOf(small).push(
      httpEndpoint({
        method: 'POST',
        path: '/stream',
        input: stream(z.object({ n: z.number() })),
        handler: async (payload: AsyncIterable<unknown>) => {
          let count = 0;
          for await (const item of payload) {
            count += item ? 1 : 0;
          }
          return { count };
        },
      }),
    );
    // Тот же лимит у endpoint'а с пайплайном: путь исполнения один
    routesOf(small).push(
      httpEndpoint({
        method: 'POST',
        path: '/stream-piped',
        input: stream(z.object({ n: z.number() })),
        pipeline: makePipeline(),
        handler: async (payload: AsyncIterable<unknown>) => {
          let count = 0;
          for await (const item of payload) {
            count += item ? 1 : 0;
          }
          return { count };
        },
      }),
    );
    smallUrl = await listen(small);

    unlimited = makeTransport({ maxBodySize: 0 });
    routesOf(unlimited).push(
      httpEndpoint({
        method: 'POST',
        path: '/json',
        input: z.object({ name: z.string() }),
        handler: (payload: { name: string }) =>
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

  it('NDJSON-строка больше лимита → 413 с кодом ядра', async () => {
    for (const path of ['/stream', '/stream-piped']) {
      const response = await fetch(`${smallUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-ndjson' },
        body: 'x'.repeat(300),
      });

      // Лимит срабатывает во время чтения, то есть уже внутри хендлера;
      // код ядра проводит 413 через границу, не давая ей сделать 500
      expect(response.status).toBe(413);
      const body = await response.json();
      expect(body.code).toBe('payload_too_large');
    }
  });
});

describe('HttpTransport — timeouts and graceful close', () => {
  it('таймауты применяются к серверу', async () => {
    const transport = makeTransport({
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
    const transport = makeTransport({ keepAliveTimeout: 60_000 });
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/ping',
        pipeline: makePipeline(),
        handler: () => new Ok({ pong: true }),
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
    const transport = makeTransport();
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/hang',
        pipeline: makePipeline(),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        handler: () => new Promise<never>(() => {}), // никогда не резолвится
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
    const transport = makeTransport();
    const { handle, started, aborted } = makeAwaitingHandler();
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/slow',
        pipeline: makePipeline(),
        handler: handle,
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
    const transport = makeTransport();
    let captured: AbortSignal | undefined;
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/ping',
        pipeline: makePipeline(),
        handler: (_payload: unknown, meta: { signal: AbortSignal }) => {
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
    const transport = makeTransport({ closeTimeout: 5000 });
    const { handle, started, aborted } = makeAwaitingHandler();
    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/graceful',
        pipeline: makePipeline(),
        handler: handle,
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
    const transport = makeTransport();
    const { handle, started, aborted } = makeAwaitingHandler();
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/raw',
        handler: (_payload: unknown, meta: { signal: AbortSignal }) => {
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
    const transport = makeTransport();
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/ping',
        pipeline: makePipeline(),
        handler: () => new Ok({ pong: true }),
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

  it('серия запросов оставляет реестр контроллеров пустым', async () => {
    const transport = makeTransport();
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/ping',
        pipeline: makePipeline(),
        handler: () => new Ok({ pong: true }),
      }),
    );
    const baseUrl = await listen(transport);

    for (let i = 0; i < 20; i++) {
      const response = await fetch(`${baseUrl}/ping`);
      await response.json();
    }

    // Событие 'close' ответа приходит после его завершения: даём ему дойти
    await new Promise((r) => setTimeout(r, 50));

    const { active } = transport as unknown as {
      active: Set<AbortController>;
    };
    expect(active.size).toBe(0);

    await transport.close();
  });

  it('close() взводит сигналы всех запросов в полёте', async () => {
    const transport = makeTransport({ closeTimeout: 5000 });
    const signals: AbortSignal[] = [];
    let onAllStarted!: () => void;
    const allStarted = new Promise<void>((r) => (onAllStarted = r));

    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/hold',
        pipeline: makePipeline(),
        handler: (_payload: unknown, meta: { signal: AbortSignal }) => {
          signals.push(meta.signal);
          if (signals.length === 3) {
            onAllStarted();
          }

          const aborted = new Promise<void>((resolve) => {
            meta.signal.addEventListener('abort', () => resolve(), {
              once: true,
            });
          });

          return aborted.then(() => new Ok({ done: true }));
        },
      }),
    );
    const baseUrl = await listen(transport);

    const pending = Promise.all(
      [1, 2, 3].map(() => fetch(`${baseUrl}/hold`).catch(() => null)),
    );
    await allStarted;

    await transport.close();

    expect(signals).toHaveLength(3);
    for (const signal of signals) {
      expect(signal.aborted).toBe(true);
      expect((signal.reason as Error).message).toBe('transport closing');
    }

    await pending;
  });
});

/** Сырой GET через node:http: нужны rawHeaders, fetch склеивает дубликаты */
function rawGet(
  baseUrl: string,
  path: string,
): Promise<{ status: number; headers: Map<string, string[]>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(`${baseUrl}${path}`, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const headers = new Map<string, string[]>();
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          const name = res.rawHeaders[i].toLowerCase();
          headers.set(name, [
            ...(headers.get(name) ?? []),
            res.rawHeaders[i + 1],
          ]);
        }
        resolve({
          status: res.statusCode ?? 0,
          headers,
          body: Buffer.concat(chunks).toString(),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('HttpTransport — ответ формы value и raw.pattern', () => {
  it('JSON-ответ несёт content-length по длине тела', async () => {
    const transport = makeTransport();
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/users/42',
        pipeline: makePipeline(),
        handler: () => new Ok({ id: '42', name: 'Алиса' }),
      }),
    );
    const baseUrl = await listen(transport);

    const { status, headers, body } = await rawGet(baseUrl, '/users/42');

    expect(status).toBe(200);
    expect(headers.get('content-type')).toEqual(['application/json']);
    expect(headers.get('content-length')).toEqual([
      String(Buffer.byteLength(body)),
    ]);
    expect(JSON.parse(body)).toEqual({ id: '42', name: 'Алиса' });

    await transport.close();
  });

  it('заголовок хендлера перекрывает заголовок формы в любом регистре', async () => {
    const transport = makeTransport();
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/plain',
        pipeline: makePipeline(),
        handler: () =>
          Ok.created('hello', {
            'Content-Type': 'text/plain',
            Location: '/plain/1',
          }),
      }),
    );
    const baseUrl = await listen(transport);

    const { status, headers } = await rawGet(baseUrl, '/plain');

    expect(status).toBe(201);
    expect(headers.get('content-type')).toEqual(['text/plain']);
    expect(headers.get('location')).toEqual(['/plain/1']);

    await transport.close();
  });

  it('raw.pattern несёт путь как прислан клиентом, а query читается картой', async () => {
    const transport = makeTransport();
    let seen: string | undefined;
    const observe = makePipeline().finally((_outcome, _res, ctx) => {
      seen = ctx.raw.pattern;
    });
    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/users/:id',
        input: z.object({
          id: z.string(),
          limit: z.coerce.number().optional(),
        }),
        pipeline: observe,
        handler: (input) => new Ok(input),
      }),
    );
    const baseUrl = await listen(transport);

    const response = await fetch(`${baseUrl}/users/a%20b?limit=1`);

    expect(await response.json()).toEqual({ id: 'a b', limit: 1 });
    expect(seen).toBe('GET /users/a%20b');

    await transport.close();
  });
});
