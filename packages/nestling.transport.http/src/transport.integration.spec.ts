/**
 * Интеграционные тесты HTTP-транспорта на реальном node:http-сервере.
 *
 * Покрывают transport-hardening: безопасность 500-ответов, классификация
 * ошибок входа (400/413), лимиты размера тела и graceful close.
 */

import { getEventListeners } from 'node:events';
import type { Server } from 'node:http';
import { type AddressInfo, connect } from 'node:net';

import { HttpTransport } from './transport.js';

import { definePipeline, Fail, Ok, stream, validate } from '@nestling/pipeline';
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
    transport.route({
      transport: 'http',
      pattern: 'POST /boom',
      pipeline: definePipeline(),
      handle: () => {
        throw new Error('db password invalid');
      },
    });
    transport.route({
      transport: 'http',
      pattern: 'POST /fail',
      pipeline: definePipeline(),
      handle: () => {
        throw Fail.badRequest('Email already taken', { field: 'email' });
      },
    });
    baseUrl = await listen(transport);

    exposed = new HttpTransport({ exposeErrorDetails: true });
    exposed.route({
      transport: 'http',
      pattern: 'POST /boom',
      pipeline: definePipeline(),
      handle: () => {
        throw new Error('boom');
      },
    });
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

describe('HttpTransport — request validation errors', () => {
  let transport: HttpTransport;
  let baseUrl: string;

  beforeAll(async () => {
    transport = new HttpTransport();

    // JSON endpoint с pipeline validate()
    transport.route({
      transport: 'http',
      pattern: 'POST /json',
      input: z.object({ name: z.string() }),
      pipeline: definePipeline().use(validate()),
      handle: (payload: { name: string }) => new Ok({ ok: payload.name }),
    });

    // Конфликт ключей body/query
    transport.route({
      transport: 'http',
      pattern: 'POST /conflict',
      input: z.object({ id: z.coerce.number() }),
      pipeline: definePipeline().use(validate()),
      handle: (payload: { id: number }) => new Ok(payload),
    });

    // Fallback без pipeline — валидация в транспорте
    transport.route({
      transport: 'http',
      pattern: 'POST /fallback',
      input: z.object({ name: z.string() }),
      handle: (payload: { name: string }) => ({ ok: payload.name }),
    });

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

  it('конфликт ключей body/query → 400 с именем ключа', async () => {
    const response = await fetch(`${baseUrl}/conflict?id=2`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1 }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('id');
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

describe('HttpTransport — body size limits', () => {
  let small: HttpTransport;
  let unlimited: HttpTransport;
  let smallUrl: string;
  let unlimitedUrl: string;

  beforeAll(async () => {
    small = new HttpTransport({ maxBodySize: 100 });
    small.route({
      transport: 'http',
      pattern: 'POST /json',
      input: z.object({ name: z.string() }),
      pipeline: definePipeline().use(validate()),
      handle: (payload: { name: string }) => new Ok({ ok: payload.name }),
    });
    small.route({
      transport: 'http',
      pattern: 'POST /stream',
      input: stream(z.object({ n: z.number() })),
      // Без pipeline: ошибка чанка всплывает в верхний catch → 413
      handle: async (payload: AsyncIterable<unknown>) => {
        let count = 0;
        for await (const item of payload) {
          count += item ? 1 : 0;
        }
        return { count };
      },
    });
    smallUrl = await listen(small);

    unlimited = new HttpTransport({ maxBodySize: 0 });
    unlimited.route({
      transport: 'http',
      pattern: 'POST /json',
      input: z.object({ name: z.string() }),
      pipeline: definePipeline().use(validate()),
      handle: (payload: { name: string }) =>
        new Ok({ length: payload.name.length }),
    });
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
    transport.route({
      transport: 'http',
      pattern: 'GET /ping',
      pipeline: definePipeline(),
      handle: () => new Ok({ pong: true }),
    });
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
    transport.route({
      transport: 'http',
      pattern: 'POST /hang',
      pipeline: definePipeline(),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      handle: () => new Promise<never>(() => {}), // никогда не резолвится
    });
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
    transport.route({
      transport: 'http',
      pattern: 'GET /slow',
      pipeline: definePipeline(),
      handle,
    });
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
    transport.route({
      transport: 'http',
      pattern: 'GET /ping',
      pipeline: definePipeline(),
      handle: (_payload: unknown, meta: { signal: AbortSignal }) => {
        captured = meta.signal;
        return new Ok({ pong: true });
      },
    });
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
    transport.route({
      transport: 'http',
      pattern: 'POST /graceful',
      pipeline: definePipeline(),
      handle,
    });
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
    transport.route({
      transport: 'http',
      pattern: 'GET /raw',
      handle: (_payload: unknown, meta: { signal: AbortSignal }) => {
        const result = handle(_payload, meta);
        return result.then((ok) => ok.value);
      },
    });
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
    transport.route({
      transport: 'http',
      pattern: 'GET /ping',
      pipeline: definePipeline(),
      handle: () => new Ok({ pong: true }),
    });
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
