/**
 * Интеграционные тесты стриминга на реальном node:http-сервере.
 *
 * Покрывают framing по форме (NDJSON против SSE), SSE-специфику словаря,
 * реконнект, multipart с лимитами полей, mid-stream политику и контракт
 * «транспорт закрывает итератор».
 */

import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';

import { httpEndpoint } from './helpers.js';
import { HttpTransport } from './transport.js';

import type { FilePart, Outcome, PhasedPipeline } from '@nestling/pipeline';
import {
  events,
  makePipeline,
  multipart,
  Ok,
  stream,
  upload,
} from '@nestling/pipeline';
import { Topic } from '@nestling/streams';
import { z } from 'zod';

const Row = z.object({ id: z.string() });
type Row = z.infer<typeof Row>;

const Event = z.object({ id: z.string(), kind: z.string() });
type Event = z.infer<typeof Event>;

/** Заглушка диагностики: дефолтный console.error шумит в выводе тестов */
const silent = { onUnknownFail: (): void => undefined };

async function listen(transport: HttpTransport): Promise<string> {
  await transport.listen(0, '127.0.0.1');
  const server = (transport as unknown as { server: Server }).server;
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

/** Читает ответ целиком, отдавая заголовки и тело */
function get(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  const url = new URL(path, baseUrl);

  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: 'GET',
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
        res.on('error', reject);
      },
    );

    req.on('error', reject);
    req.end();
  });
}

/**
 * Открывает ответ и отдаёт куски по мере поступления; `abort()` рвёт
 * соединение — так изображается отвал клиента.
 */
function open(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
): { chunks: string[]; abort: () => void; done: Promise<void> } {
  const url = new URL(path, baseUrl);
  const chunks: string[] = [];

  // Исполнитель Promise синхронен, поэтому к моменту подписки ниже
  // `settle` уже присвоен
  let settle!: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const req = request(
    {
      method: 'GET',
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      headers,
    },
    (res) => {
      res.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
      res.on('end', settle);
      res.on('close', settle);
      res.on('error', settle);
    },
  );

  req.on('error', settle);
  req.end();

  return { chunks, abort: () => req.destroy(), done };
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Ждёт условия с коротким опросом: сеть асинхронна, спать вслепую нельзя */
async function until(predicate: () => boolean, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('condition was not met in time');
    }
    await delay(10);
  }
}

async function* rows(...ids: string[]): AsyncIterableIterator<Row> {
  for (const id of ids) {
    yield { id };
  }
}

/** Собирает тело multipart/form-data с одним файловым полем */
function multipartBody(
  fields: Record<string, string>,
  file: { field: string; filename: string; mime: string; content: string },
): { body: Buffer; contentType: string } {
  const boundary = '----nestlingtest';
  const parts: string[] = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );
  }

  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; ` +
      `filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n` +
      `${file.content}\r\n`,
    `--${boundary}--\r\n`,
  );

  return {
    body: Buffer.from(parts.join('')),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * Пайплайн-наблюдатель исхода — **значение**, а не инлайн в декларации.
 *
 * В позиции аргумента `transport.route(...)` контекстный тип фиксирует
 * `TNeeds = never`, и вывод типа юнита в цепочке `.finally` схлопывается.
 * Общий пайплайн значением — и без того канонический стиль (`basePipeline`
 * в примерах), поэтому тесты пишутся так же.
 */
function observing(record: (outcome: Outcome) => void): PhasedPipeline {
  return makePipeline().finally(record);
}

describe('framing по форме output', () => {
  let transport: HttpTransport;
  let baseUrl: string;
  const outcomes: string[] = [];

  beforeAll(async () => {
    transport = new HttpTransport({ ...silent, sseHeartbeat: 0 });

    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/rows',
        output: stream(Row),
        pipeline: observing((outcome) => outcomes.push(`rows:${outcome}`)),
        handle: async () => new Ok(rows('1', '2', '3')),
      }),
    );

    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/live',
        output: events(Event),
        sse: { id: (item) => item.id, event: (item) => item.kind },
        pipeline: makePipeline(),
        handle: async () =>
          new Ok(
            (async function* (): AsyncIterableIterator<Event> {
              yield { id: '7', kind: 'created' };
              yield { id: '8', kind: 'updated' };
            })(),
          ),
      }),
    );

    baseUrl = await listen(transport);
  });

  afterAll(async () => {
    await transport.close();
  });

  it('stream отдаётся NDJSON и завершается штатно', async () => {
    const response = await get(baseUrl, '/rows');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/x-ndjson');
    expect(response.body.trim().split('\n')).toEqual([
      '{"id":"1"}',
      '{"id":"2"}',
      '{"id":"3"}',
    ]);
  });

  it('.finally у потоковой ручки срабатывает после последнего байта', async () => {
    outcomes.length = 0;
    await get(baseUrl, '/rows');
    await until(() => outcomes.length > 0);

    expect(outcomes).toEqual(['rows:completed']);
  });

  it('events отдаётся SSE с id и именем события', async () => {
    const response = await get(baseUrl, '/live');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.body).toBe(
      'id: 7\nevent: created\ndata: {"id":"7","kind":"created"}\n\n' +
        'id: 8\nevent: updated\ndata: {"id":"8","kind":"updated"}\n\n',
    );
  });
});

describe('SSE: heartbeat, реконнект, дисконнект', () => {
  let transport: HttpTransport;
  let baseUrl: string;
  let hub: Topic<Event>;
  const seenLastEventId: (string | undefined)[] = [];
  const outcomes: string[] = [];

  beforeAll(async () => {
    hub = new Topic<Event>({ buffer: 8 });
    transport = new HttpTransport({ ...silent, sseHeartbeat: 20 });

    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/hub',
        output: events(Event),
        pipeline: observing((outcome) => outcomes.push(outcome)),
        handle: async (
          _payload: unknown,
          meta: { signal: AbortSignal; lastEventId?: string },
        ) => {
          seenLastEventId.push(meta.lastEventId);
          return new Ok(hub.subscribe(meta.signal));
        },
      }),
    );

    baseUrl = await listen(transport);
  });

  afterAll(async () => {
    hub.close();
    await transport.close();
  });

  it('heartbeat держит молчащее соединение живым, не считаясь элементом', async () => {
    const connection = open(baseUrl, '/hub');

    await until(() => connection.chunks.join('').includes(': heartbeat'));
    connection.abort();
    await connection.done;

    expect(connection.chunks.join('')).not.toContain('data:');
  });

  it('Last-Event-ID приезжает в стартовый контекст', async () => {
    seenLastEventId.length = 0;

    const connection = open(baseUrl, '/hub', { 'last-event-id': '42' });
    await until(() => seenLastEventId.length > 0);
    connection.abort();
    await connection.done;

    expect(seenLastEventId[0]).toBe('42');

    const first = open(baseUrl, '/hub');
    await until(() => seenLastEventId.length > 1);
    first.abort();
    await first.done;

    expect(seenLastEventId[1]).toBeUndefined();
  });

  it('дисконнект закрывает итератор и снимает подписку', async () => {
    // Соседние тесты рвут соединение, не дожидаясь серверной уборки:
    // без этого «подписчик ровно один» мог бы совпасть с их хвостом, и
    // push уехал бы мимо открываемого ниже соединения
    await until(() => hub.subscribers === 0);

    outcomes.length = 0;
    const connection = open(baseUrl, '/hub');

    await until(() => hub.subscribers === 1);
    hub.push({ id: '1', kind: 'created' });
    await until(() => connection.chunks.join('').includes('data:'));

    connection.abort();
    await connection.done;

    await until(() => hub.subscribers === 0);
    await until(() => outcomes.length > 0);
    expect(outcomes).toEqual(['disconnected']);
  });
});

describe('mid-stream политика', () => {
  let transport: HttpTransport;
  let baseUrl: string;
  const outcomes: string[] = [];

  beforeAll(async () => {
    transport = new HttpTransport({ ...silent, sseHeartbeat: 0 });

    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/rows-broken',
        output: stream(Row),
        pipeline: observing((outcome) => outcomes.push(`ndjson:${outcome}`)),
        handle: async () =>
          new Ok(
            (async function* (): AsyncIterableIterator<Row> {
              yield { id: '1' };
              throw new Error('boom');
            })(),
          ),
      }),
    );

    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/live-broken',
        output: events(Event),
        pipeline: observing((outcome) => outcomes.push(`sse:${outcome}`)),
        handle: async () =>
          new Ok(
            (async function* (): AsyncIterableIterator<Event> {
              yield { id: '1', kind: 'created' };
              throw new Error('boom');
            })(),
          ),
      }),
    );

    baseUrl = await listen(transport);
  });

  afterAll(async () => {
    await transport.close();
  });

  it('NDJSON: соединение обрывается, исход — failed', async () => {
    outcomes.length = 0;

    // Ответ незавершён: клиент видит обрыв, а не «успешный» конец
    await expect(get(baseUrl, '/rows-broken')).rejects.toThrow();

    await until(() => outcomes.length > 0);
    expect(outcomes).toEqual(['ndjson:failed']);
  });

  it('SSE: уходит кадр event: error с кодом, затем закрытие', async () => {
    outcomes.length = 0;

    const response = await get(baseUrl, '/live-broken');

    expect(response.body).toContain('data: {"id":"1","kind":"created"}');
    expect(response.body).toContain('event: error');
    expect(response.body).toContain('"code":"UNKNOWN"');

    await until(() => outcomes.length > 0);
    expect(outcomes).toEqual(['sse:failed']);
  });
});

describe('приём потокового входа и multipart', () => {
  let transport: HttpTransport;
  let baseUrl: string;
  let lastSummary: { itemsIn: number; bytesIn?: number } | undefined;

  beforeAll(async () => {
    transport = new HttpTransport({ ...silent, maxBodySize: 64 * 1024 });

    const summarizing = makePipeline().finally((_outcome, _res, ctx) => {
      lastSummary = { ...ctx.summary };
    });

    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/import',
        input: stream(Row).limit(3),
        output: z.object({ imported: z.number() }),
        pipeline: summarizing,
        handle: async (source: AsyncIterableIterator<Row>) => {
          const ids: string[] = [];
          for await (const row of source) {
            ids.push(row.id);
          }
          return new Ok({ imported: ids.length });
        },
      }),
    );

    transport.route(
      httpEndpoint({
        method: 'POST',
        path: '/avatars/:id',
        input: multipart({
          fields: z.object({ id: z.string() }),
          files: {
            avatar: upload({ maxSize: 32, mime: ['image/png'] }),
          },
        }),
        pipeline: makePipeline(),
        handle: async (payload: {
          fields: { id: string };
          files: { avatar: FilePart };
        }) =>
          new Ok({
            id: payload.fields.id,
            filename: payload.files.avatar.filename,
          }),
      }),
    );

    baseUrl = await listen(transport);
  });

  afterAll(async () => {
    await transport.close();
  });

  const post = async (
    path: string,
    body: string | Buffer,
    contentType: string,
  ): Promise<{ status: number; body: string }> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    return { status: response.status, body: await response.text() };
  };

  it('NDJSON-вход доезжает до хендлера валидированным, счётчики растут', async () => {
    const ndjson = ['{"id":"1"}', '{"id":"2"}'].join('\n');
    const response = await post('/import', ndjson, 'application/x-ndjson');

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ imported: 2 });
    expect(lastSummary?.itemsIn).toBe(2);
    expect(lastSummary?.bytesIn).toBe(Buffer.byteLength(ndjson));
  });

  it('невалидный элемент входа отказывает 400 с кодом валидации', async () => {
    const response = await post(
      '/import',
      '{"id":"1"}\n{"id":42}',
      'application/x-ndjson',
    );

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('.limit входной цепочки даёт 413 с кодом', async () => {
    const response = await post(
      '/import',
      ['{"id":"1"}', '{"id":"2"}', '{"id":"3"}', '{"id":"4"}'].join('\n'),
      'application/x-ndjson',
    );

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body).code).toBe('STREAM_LIMIT_EXCEEDED');
  });

  it('multipart отдаёт файл под именем поля, path-параметр — в fields', async () => {
    const { body, contentType } = multipartBody(
      {},
      {
        field: 'avatar',
        filename: 'a.png',
        mime: 'image/png',
        content: 'tiny',
      },
    );

    const response = await post('/avatars/42', body, contentType);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      id: '42',
      filename: 'a.png',
    });
  });

  it('файл сверх upload({ maxSize }) отвергается 413', async () => {
    const { body, contentType } = multipartBody(
      {},
      {
        field: 'avatar',
        filename: 'big.png',
        mime: 'image/png',
        content: 'x'.repeat(200),
      },
    );

    const response = await post('/avatars/42', body, contentType);

    expect(response.status).toBe(413);
  });

  it('неверный MIME отвергается 400 до чтения тела', async () => {
    const { body, contentType } = multipartBody(
      {},
      {
        field: 'avatar',
        filename: 'a.txt',
        mime: 'text/plain',
        content: 'tiny',
      },
    );

    const response = await post('/avatars/42', body, contentType);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(
      /expects one of image\/png/,
    );
  });

  it('незаявленное файловое поле отвергается 400', async () => {
    const { body, contentType } = multipartBody(
      {},
      {
        field: 'cover',
        filename: 'a.png',
        mime: 'image/png',
        content: 'tiny',
      },
    );

    const response = await post('/avatars/42', body, contentType);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(
      /Unexpected file field 'cover'/,
    );
  });
});

describe('close() завершает открытые events-соединения', () => {
  it('сигнал взводится, итератор закрывается, соединение завершается', async () => {
    const hub = new Topic<Event>({ buffer: 4 });
    const outcomes: string[] = [];
    const transport = new HttpTransport({ ...silent, sseHeartbeat: 0 });

    transport.route(
      httpEndpoint({
        method: 'GET',
        path: '/hub',
        output: events(Event),
        pipeline: observing((outcome) => outcomes.push(outcome)),
        handle: async (_payload: unknown, meta: { signal: AbortSignal }) =>
          new Ok(hub.subscribe(meta.signal)),
      }),
    );

    const baseUrl = await listen(transport);
    const connection = open(baseUrl, '/hub');

    await until(() => hub.subscribers === 1);

    await transport.close({ timeout: 1000 });
    await connection.done;

    await until(() => hub.subscribers === 0);
    expect(outcomes).toEqual(['aborted']);
  });
});
