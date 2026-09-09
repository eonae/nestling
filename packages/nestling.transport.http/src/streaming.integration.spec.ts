/**
 * Интеграционные тесты стриминга на реальном node:http-сервере.
 *
 * Покрывают framing по форме (NDJSON против SSE), SSE-специфику словаря,
 * реконнект, multipart с лимитами полей, mid-stream политику и операция
 * «транспорт закрывает итератор».
 */

import { request } from 'node:http';

import { httpEndpoint } from './helpers.js';
import { HttpResponse } from './response.js';
import { HttpServer } from './server.js';
import type { HttpTransportOptions } from './transport.js';
import { HttpTransport } from './transport.js';

import type {
  ExecutableDeclaration,
  Fields,
  FilePart,
  Logger,
  LogLevel,
  Outcome,
  PhasedPipeline,
} from '@nestling/app';
import {
  events,
  makeDispatch,
  makePipeline,
  multipart,
  Ok,
  stream,
  upload,
} from '@nestling/app';
import { Topic } from '@nestling/operations';
import { z } from 'zod';

const Row = z.object({ id: z.string() });
type Row = z.infer<typeof Row>;

const Event = z.object({ id: z.string(), kind: z.string() });
type Event = z.infer<typeof Event>;

/** Логгер-шпион: записи ядра копятся значениями, а не уходят в stderr */
function spyLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const make = (bindings: Fields): Logger => {
    const write =
      (level: LogLevel) =>
      (first: string | Error | Fields, second?: Fields): void => {
        if (typeof first === 'string') {
          entries.push({
            level,
            message: first,
            fields: { ...bindings, ...second },
          });
        } else if (first instanceof Error) {
          entries.push({
            level,
            message: first.message,
            fields: { ...bindings, ...second, err: first },
          });
        } else {
          entries.push({
            level,
            message: '',
            fields: { ...bindings, ...first },
          });
        }
      };

    return {
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
      child: (extra) => make({ ...bindings, ...extra }),
    };
  };

  return { logger: make({}), entries };
}

interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: Fields;
}

/** Умолчание ядра пишет в stderr и шумит в выводе тестов: записи копит шпион */
const silent = spyLogger().logger;

/** Серверы тестовых транспортов: сокет держит сервер, а не транспорт */
const servers = new WeakMap<HttpTransport, HttpServer>();

/** Сигналы прогонов: взводятся первым шагом остановки, как в `App` */
const controllers = new WeakMap<HttpTransport, AbortController>();

/**
 * Транспорт для теста вместе с его сервером: эфемерный порт и
 * loopback-хост.
 *
 * Адреса у транспорта нет: сокетом владеет сервер, поэтому порт задаётся
 * ему, а фактический читается через `address()` сервера.
 */
function makeTransport(
  options: HttpTransportOptions & { readonly closeTimeout?: number } = {},
): HttpTransport {
  const { closeTimeout, ...transportOptions } = options;

  const server = new HttpServer({
    port: 0,
    host: '127.0.0.1',
    ...(closeTimeout === undefined ? {} : { closeTimeout }),
  });

  const transport = new HttpTransport(server, transportOptions);
  servers.set(transport, server);

  return transport;
}

/** Сервер тестового транспорта */
function serverOf(transport: HttpTransport): HttpServer {
  const server = servers.get(transport);

  if (!server) {
    throw new Error('transport was not created by makeTransport()');
  }

  return server;
}

/**
 * Останавливает связку в том же порядке, что фаза SHUTDOWN: взвод
 * сигнала, дренаж сервера, отмена запросов в обработке транспортом.
 */
async function shutdown(transport: HttpTransport): Promise<void> {
  controllers.get(transport)?.abort();
  await serverOf(transport).drain();
  await transport.close();
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

/** Поднимает транспорт и его сервер на эфемерном порту, отдаёт базовый URL */
async function listen(transport: HttpTransport): Promise<string> {
  const controller = new AbortController();
  controllers.set(transport, controller);

  await transport.serve(
    makeDispatch(routesOf(transport), { logger: silent }),
    controller.signal,
  );

  // Сокет открывается последним шагом START — после `serve`
  const server = serverOf(transport);
  await server.listen();

  const address = server.address();
  if (!address) {
    throw new Error('server did not report an address after listen()');
  }

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
 * В позиции аргумента `routesOf(transport).push(...)` контекстный тип фиксирует
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
    transport = makeTransport({ sseHeartbeat: 0 });

    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/rows',
        output: stream(Row),
        pipeline: observing((outcome) => outcomes.push(`rows:${outcome}`)),
        handler: async () => new Ok(rows('1', '2', '3')),
      }),
    );

    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/feed',
        output: events(Event),
        pipeline: makePipeline(),
        handler: async () =>
          HttpResponse.of(
            (async function* (): AsyncIterableIterator<Event> {
              yield { id: '9', kind: 'created' };
            })(),
            { headers: { 'x-feed': 'live' } },
          ),
      }),
    );

    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/live',
        output: events(Event),
        sse: { id: (item) => item.id, event: (item) => item.kind },
        pipeline: makePipeline(),
        handler: async () =>
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
    await shutdown(transport);
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

  it(".finally у потокового endpoint'а срабатывает после последнего байта", async () => {
    outcomes.length = 0;
    await get(baseUrl, '/rows');
    await until(() => outcomes.length > 0);

    expect(outcomes).toEqual(['rows:completed']);
  });

  it('заголовки потока уходят до первого кадра', async () => {
    const response = await get(baseUrl, '/feed');

    // Заголовок в ответе есть, и кадр за ним: поставленный после первого
    // write он стоил бы ERR_HTTP_HEADERS_SENT
    expect(response.headers['x-feed']).toBe('live');
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.body).toContain('data: {"id":"9","kind":"created"}');
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
    transport = makeTransport({ sseHeartbeat: 20 });

    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/hub',
        output: events(Event),
        pipeline: observing((outcome) => outcomes.push(outcome)),
        handler: async (
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
    await shutdown(transport);
  });

  it('heartbeat держит молчащее соединение живым, не считаясь элементом', async () => {
    const connection = open(baseUrl, '/hub');

    await until(() => connection.chunks.join('').includes(': heartbeat'));
    connection.abort();
    await connection.done;

    expect(connection.chunks.join('')).not.toContain('data:');
  });

  it('Last-Event-ID попадает в стартовый контекст', async () => {
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
    // push прошёл бы мимо открываемого ниже соединения
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

describe('дисконнект до первого кадра', () => {
  let transport: HttpTransport;
  let baseUrl: string;
  let hub: Topic<Event>;
  let feed: Topic<Row>;
  const outcomes: string[] = [];
  let handled = 0;

  beforeAll(async () => {
    hub = new Topic<Event>({ buffer: 8 });
    feed = new Topic<Row>({ buffer: 8 });
    transport = makeTransport({ sseHeartbeat: 0 });

    /**
     * Хендлер, отдающий ответ уже после отвала клиента: сигнал взведён
     * раньше, чем транспорт запишет первый кадр.
     *
     * Подписка берётся **без** сигнала — иначе тема завершила бы её сама,
     * и закрытие итератора ответа осталось бы непроверенным.
     */
    const respondAfterDisconnect =
      <T>(topic: Topic<T>) =>
      async (
        _payload: unknown,
        meta: { signal: AbortSignal },
      ): Promise<Ok<AsyncIterableIterator<T>>> => {
        handled += 1;
        await until(() => meta.signal.aborted);

        return new Ok(topic.subscribe());
      };

    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/late-events',
        output: events(Event),
        pipeline: observing((outcome) => outcomes.push(outcome)),
        handler: respondAfterDisconnect(hub),
      }),
      httpEndpoint({
        method: 'GET',
        path: '/late-rows',
        output: stream(Row),
        pipeline: observing((outcome) => outcomes.push(outcome)),
        handler: respondAfterDisconnect(feed),
      }),
    );

    baseUrl = await listen(transport);
  });

  afterAll(async () => {
    hub.close();
    feed.close();
    await shutdown(transport);
  });

  it('events: .finally выполняется с исходом disconnected', async () => {
    outcomes.length = 0;
    handled = 0;

    const connection = open(baseUrl, '/late-events');
    await until(() => handled === 1);
    connection.abort();
    await connection.done;

    await until(() => outcomes.length > 0);

    expect(outcomes).toEqual(['disconnected']);
    // Ни одного кадра клиент не получил, а подписка снята
    expect(connection.chunks.join('')).not.toContain('data:');
    expect(hub.subscribers).toBe(0);
  });

  it('stream: итератор непрочитанного NDJSON-ответа закрыт', async () => {
    outcomes.length = 0;
    handled = 0;

    const connection = open(baseUrl, '/late-rows');
    await until(() => handled === 1);
    connection.abort();
    await connection.done;

    await until(() => outcomes.length > 0);

    expect(outcomes).toEqual(['disconnected']);
    expect(feed.subscribers).toBe(0);
  });
});

describe('mid-stream политика', () => {
  let transport: HttpTransport;
  let baseUrl: string;
  const outcomes: string[] = [];

  beforeAll(async () => {
    transport = makeTransport({ sseHeartbeat: 0 });

    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/rows-broken',
        output: stream(Row),
        pipeline: observing((outcome) => outcomes.push(`ndjson:${outcome}`)),
        handler: async () =>
          new Ok(
            (async function* (): AsyncIterableIterator<Row> {
              yield { id: '1' };
              throw new Error('boom');
            })(),
          ),
      }),
    );

    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/live-broken',
        output: events(Event),
        pipeline: observing((outcome) => outcomes.push(`sse:${outcome}`)),
        handler: async () =>
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
    await shutdown(transport);
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
    expect(response.body).toContain('"code":"internal_error"');

    await until(() => outcomes.length > 0);
    expect(outcomes).toEqual(['sse:failed']);
  });
});

describe('приём потокового входа и multipart', () => {
  let transport: HttpTransport;
  let baseUrl: string;
  let lastSummary: { itemsIn: number; bytesIn?: number } | undefined;

  beforeAll(async () => {
    transport = makeTransport({ maxBodySize: 64 * 1024 });

    const summarizing = makePipeline().finally((_outcome, _res, ctx) => {
      lastSummary = { ...ctx.summary };
    });

    routesOf(transport).push(
      httpEndpoint({
        method: 'POST',
        path: '/import',
        input: stream(Row).limit(3),
        output: z.object({ imported: z.number() }),
        pipeline: summarizing,
        handler: async (source: AsyncIterableIterator<Row>) => {
          const ids: string[] = [];
          for await (const row of source) {
            ids.push(row.id);
          }
          return new Ok({ imported: ids.length });
        },
      }),
    );

    routesOf(transport).push(
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
        handler: async (payload: {
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
    await shutdown(transport);
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

  it('NDJSON-вход передаётся в хендлер валидированным, счётчики растут', async () => {
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
    expect(JSON.parse(response.body).code).toBe('bad_request');
  });

  it('.limit входной цепочки даёт 413 с кодом', async () => {
    const response = await post(
      '/import',
      ['{"id":"1"}', '{"id":"2"}', '{"id":"3"}', '{"id":"4"}'].join('\n'),
      'application/x-ndjson',
    );

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body).code).toBe('payload_too_large');
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

describe('остановка завершает открытые events-соединения', () => {
  it('сигнал взводится, итератор закрывается, соединение завершается', async () => {
    const hub = new Topic<Event>({ buffer: 4 });
    const outcomes: string[] = [];
    const transport = makeTransport({ sseHeartbeat: 0, closeTimeout: 1000 });

    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/hub',
        output: events(Event),
        pipeline: observing((outcome) => outcomes.push(outcome)),
        handler: async (_payload: unknown, meta: { signal: AbortSignal }) =>
          new Ok(hub.subscribe(meta.signal)),
      }),
    );

    const baseUrl = await listen(transport);
    const connection = open(baseUrl, '/hub');

    await until(() => hub.subscribers === 1);

    await shutdown(transport);
    await connection.done;

    await until(() => hub.subscribers === 0);
    expect(outcomes).toEqual(['aborted']);
  });
});

describe('способности транспорта при регистрации', () => {
  it('stream и events в output принимаются на serve', async () => {
    const transport = makeTransport();

    routesOf(transport).push(
      httpEndpoint({
        method: 'GET',
        path: '/rows',
        output: stream(Row),
        pipeline: makePipeline(),
        handler: async () => new Ok(rows('1')),
      }),
      httpEndpoint({
        method: 'GET',
        path: '/live',
        output: events(Event),
        pipeline: makePipeline(),
        handler: async () =>
          new Ok(
            (async function* (): AsyncIterableIterator<Event> {
              yield { id: '1', kind: 'created' };
            })(),
          ),
      }),
    );

    await expect(
      transport.serve(
        makeDispatch(routesOf(transport), { logger: silent }),
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();

    await shutdown(transport);
  });
});
