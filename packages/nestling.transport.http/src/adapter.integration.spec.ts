/**
 * Три пути на одних декларациях: сокет `http()`, node-форма адаптера,
 * fetch-форма адаптера.
 *
 * Прогон сверяет ответы целиком — статус, `content-type`, тело, — потому
 * что расхождение форм ничем другим не ловится: обещание пакета в том,
 * что декларация переезжает во встроенное приложение без единой правки.
 * Дальше идёт то, что есть только у формы `fetch`: потоки, файлы, сырые
 * байты, непойманный маршрут и отмена по разрыву соединения.
 */

import type { Server } from 'node:http';
import { createServer } from 'node:http';

import { adapter, toFetchHandler, toNodeHandler } from './adapter.js';
import { serverKeys } from './config.js';
import { httpEndpoint } from './helpers.js';
import type { HttpServer } from './server.js';
import { http } from './transport.js';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { BuiltApp, FilePart } from '@nestlingjs/app';
import {
  ClientDisconnectedError,
  events,
  makeApp,
  makeFail,
  makeFeature,
  makePipeline,
  multipart,
  objectSource,
  Ok,
  stream,
  upload,
} from '@nestlingjs/app';
import { z } from 'zod';

const Row = z.object({ id: z.string() });
type Row = z.infer<typeof Row>;

const Event = z.object({ id: z.string(), kind: z.string() });
type Event = z.infer<typeof Event>;

/** Объявленный отказ фикстур: его документ сверяется на трёх путях */
const EmailTaken = makeFail('conflict:email_taken', {
  message: 'Email already taken',
  details: z.object({ field: z.string() }),
});

/** Причина отмены, дошедшая до сигнала контекста: её ставит транспорт */
let cancelled: unknown;

/** Заголовок реконнекта, который увидел хендлер подписки */
let seenLastEventId: string | undefined;

/** Держит подписку открытой до разрыва соединения */
const untilAbort = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });

const Ping = httpEndpoint.get('/ping', {
  output: z.object({ pong: z.boolean() }),
  pipeline: makePipeline(),
  handler: async () => new Ok({ pong: true }),
});

const Echo = httpEndpoint.post('/echo', {
  input: z.object({ name: z.string() }),
  output: z.object({ name: z.string() }),
  pipeline: makePipeline(),
  handler: async (payload: { name: string }) => new Ok(payload),
});

const Boom = httpEndpoint.post('/boom', {
  pipeline: makePipeline(),
  errors: [EmailTaken],
  output: z.unknown(),
  handler: () => {
    throw EmailTaken({ field: 'email' });
  },
});

const Rows = httpEndpoint.get('/rows', {
  output: stream(Row),
  pipeline: makePipeline(),
  handler: async () =>
    new Ok(
      (async function* (): AsyncIterableIterator<Row> {
        yield { id: '1' };
        yield { id: '2' };
      })(),
    ),
});

const Live = httpEndpoint.get('/live', {
  output: events(Event),
  sse: { heartbeat: 20 },
  pipeline: makePipeline(),
  handler: async (
    _payload: unknown,
    meta: { signal: AbortSignal; lastEventId?: string },
  ) => {
    seenLastEventId = meta.lastEventId;

    return new Ok(
      (async function* (): AsyncIterableIterator<Event> {
        yield { id: '7', kind: 'created' };
        await untilAbort(meta.signal);
      })(),
    );
  },
});

const Watch = httpEndpoint.get('/watch', {
  output: events(Event),
  pipeline: makePipeline(),
  handler: async (_payload: unknown, meta: { signal: AbortSignal }) => {
    meta.signal.addEventListener(
      'abort',
      () => (cancelled = meta.signal.reason),
      { once: true },
    );

    return new Ok(
      (async function* (): AsyncIterableIterator<Event> {
        yield { id: '1', kind: 'open' };
        await untilAbort(meta.signal);
      })(),
    );
  },
});

const Upload = httpEndpoint.post('/uploads', {
  input: multipart({
    fields: z.object({ title: z.string().min(1) }),
    files: { report: upload() },
  }),
  pipeline: makePipeline(),
  output: z.unknown(),
  handler: async (payload: {
    fields: { title: string };
    files: { report: FilePart };
  }) => {
    const chunks: Buffer[] = [];
    for await (const chunk of payload.files.report.stream) {
      chunks.push(chunk as Buffer);
    }

    return new Ok({
      title: payload.fields.title,
      file: payload.files.report.filename,
      text: Buffer.concat(chunks).toString(),
    });
  },
});

const Hook = httpEndpoint.post('/hooks', {
  input: z.object({ event: z.string() }),
  output: z.object({ event: z.string(), raw: z.string() }),
  rawBody: true,
  pipeline: makePipeline<{ rawBody: Uint8Array }>(),
  handler: async (payload: { event: string }, meta: { rawBody: Uint8Array }) =>
    new Ok({
      event: payload.event,
      raw: Buffer.from(meta.rawBody).toString(),
    }),
});

const Api = makeFeature({
  name: 'api',
  endpoints: [Ping, Echo, Boom, Rows, Live, Watch, Upload, Hook],
});

/** Порт выбирает ОС, адрес — loopback: сокет теста никуда не смотрит */
const socketConfig = objectSource(
  { HTTP_PORT: '0', HTTP_HOST: '127.0.0.1' },
  'test-socket',
);

/** Ответ в сравнимом виде: то, что клиент видит на любом из трёх путей */
interface Probe {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
}

const probe = async (response: Response): Promise<Probe> => ({
  status: response.status,
  contentType: response.headers.get('content-type'),
  body: await response.text(),
});

/** Читалка тела потокового ответа: у потока она есть всегда */
const readerOf = (
  response: Response,
): ReadableStreamDefaultReader<Uint8Array> => {
  const body = response.body;

  if (!body) {
    throw new Error('streaming response has no body');
  }

  return body.getReader();
};

let socketApp: BuiltApp;
let embeddedApp: BuiltApp;
let socketUrl: string;
let nodeUrl: string;
let host: Server;

/** Взял ли запрос обработчик node-формы: `false` — маршрут не его */
let taken: boolean | undefined;

const viaSocket = async (path: string, init?: RequestInit): Promise<Probe> =>
  probe(await fetch(`${socketUrl}${path}`, init));

const viaNode = async (path: string, init?: RequestInit): Promise<Probe> =>
  probe(await fetch(`${nodeUrl}${path}`, init));

const request = (path: string, init?: RequestInit): Request =>
  new Request(`http://embedded${path}`, init);

const viaFetch = async (path: string, init?: RequestInit): Promise<Probe> =>
  probe(await toFetchHandler(embeddedApp)(request(path, init)));

/** Ждёт условия, опрашивая его: событий у чужого процесса тут нет */
const waitFor = async (done: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !done(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

beforeAll(async () => {
  socketApp = makeApp({
    features: [Api],
    transports: [http()],
    config: [[socketConfig, serverKeys()]],
  }).build();

  embeddedApp = makeApp({
    features: [Api],
    transports: [adapter()],
  }).build();

  await socketApp.run({ signals: false });
  await embeddedApp.run({ signals: false });

  const server = socketApp.servers.get('default') as HttpServer;
  socketUrl = `http://127.0.0.1:${server.address()?.port}`;

  // Хозяин процесса для node-формы: обработчик приложения плюс своя
  // маршрутизация под ним
  const handler = toNodeHandler(embeddedApp);
  host = createServer((incoming, response) => {
    void handler(incoming, response).then((served) => {
      taken = served;
      if (!served) {
        response.statusCode = 404;
        response.end('Not Found');
      }
    });
  });

  await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
  const address = host.address();
  nodeUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => host.close(() => resolve()));
  await socketApp.close();
  await embeddedApp.close();
});

describe('три формы на одних декларациях', () => {
  it('GET отвечает одинаково', async () => {
    const first = await viaSocket('/ping');

    expect(await viaNode('/ping')).toEqual(first);
    expect(await viaFetch('/ping')).toEqual(first);
    expect(first).toEqual({
      status: 200,
      contentType: 'application/json',
      body: '{"pong":true}',
    });
  });

  it('POST со значением отвечает одинаково', async () => {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    };

    const first = await viaSocket('/echo', init);

    expect(await viaNode('/echo', init)).toEqual(first);
    expect(await viaFetch('/echo', init)).toEqual(first);
    expect(first.status).toBe(200);
  });

  it('отказ проверки входа отвечает одинаково', async () => {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    };

    const first = await viaSocket('/echo', init);

    expect(await viaNode('/echo', init)).toEqual(first);
    expect(await viaFetch('/echo', init)).toEqual(first);
    expect(first.status).toBe(400);
    expect(first.contentType).toBe('application/problem+json');
  });

  it('объявленный `Fail` отвечает одинаково', async () => {
    const init: RequestInit = { method: 'POST' };
    const first = await viaSocket('/boom', init);

    expect(await viaNode('/boom', init)).toEqual(first);
    expect(await viaFetch('/boom', init)).toEqual(first);
    expect(first.status).toBe(409);
    expect(JSON.parse(first.body)).toMatchObject({
      status: 409,
      details: { field: 'email' },
    });
  });
});

describe('потоки через форму `fetch`', () => {
  it('NDJSON доходит до конца потока', async () => {
    const response = await toFetchHandler(embeddedApp)(request('/rows'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    expect(await response.text()).toBe('{"id":"1"}\n{"id":"2"}\n');

    // Тот же ответ на сокете: кадрирование у обеих форм одно
    const onSocket = await viaSocket('/rows');
    expect(onSocket.body).toBe('{"id":"1"}\n{"id":"2"}\n');
  });

  it('SSE несёт кадры, heartbeat и `Last-Event-ID`', async () => {
    const controller = new AbortController();
    const response = await toFetchHandler(embeddedApp)(
      request('/live', {
        headers: { 'last-event-id': '42' },
        signal: controller.signal,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(seenLastEventId).toBe('42');

    const reader = readerOf(response);
    const decoder = new TextDecoder();
    let seen = '';

    // Ответ доступен до конца потока: кадр и heartbeat читаются на живой
    // подписке
    while (!seen.includes(': heartbeat')) {
      const { value } = await reader.read();
      seen += decoder.decode(value);
    }

    expect(seen).toContain('data: {"id":"7","kind":"created"}');

    controller.abort();
  });

  it('обрыв посреди потока закрывает подписку', async () => {
    const controller = new AbortController();
    const response = await toFetchHandler(embeddedApp)(
      request('/live', { signal: controller.signal }),
    );

    const reader = readerOf(response);
    await reader.read();

    controller.abort();

    // Поток оборван на стороне читателя: дочитать его больше нечем
    await expect(reader.read()).rejects.toThrow();
  });
});

describe('файлы и сырые байты через форму `fetch`', () => {
  it('multipart доходит до хендлера', async () => {
    const form = new FormData();
    form.set('title', 'Report');
    form.set('report', new Blob(['hello']), 'report.txt');

    const response = await toFetchHandler(embeddedApp)(
      request('/uploads', { method: 'POST', body: form }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      title: 'Report',
      file: 'report.txt',
      text: 'hello',
    });
  });

  it('`rawBody` доходит байтами', async () => {
    const body = '{"event":"charge.succeeded"}';
    const response = await toFetchHandler(embeddedApp)(
      request('/hooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );

    expect(await response.json()).toEqual({
      event: 'charge.succeeded',
      raw: body,
    });
  });
});

describe('непойманный маршрут', () => {
  it('node-форма отдаёт `false` и не отвечает', async () => {
    taken = undefined;

    const response = await viaNode('/nowhere');

    // Ответил хозяин процесса, а не приложение
    expect(taken).toBe(false);
    expect(response.status).toBe(404);
    expect(response.body).toBe('Not Found');
  });

  it('fetch-форма отдаёт `404`', async () => {
    const response = await viaFetch('/nowhere');

    expect(response.status).toBe(404);
    expect(response.body).toBe('Not Found');
  });
});

describe('отмена по разрыву соединения', () => {
  it('взвод `request.signal` доводит `ClientDisconnectedError` до контекста', async () => {
    cancelled = undefined;

    const controller = new AbortController();
    const response = await toFetchHandler(embeddedApp)(
      request('/watch', { signal: controller.signal }),
    );

    const reader = readerOf(response);
    await reader.read();

    controller.abort();
    await waitFor(() => cancelled !== undefined);

    expect(cancelled).toBeInstanceOf(ClientDisconnectedError);
  });
});
