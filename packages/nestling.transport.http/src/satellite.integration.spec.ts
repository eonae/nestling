/**
 * Satellite-транспорт: проверка границы пакета.
 *
 * Тест собирает `ITransport` поверх собственного `node:http`-сервера из
 * одних публичных экспортов `@nestling/transport.http` и сверяет его
 * ответы с ответами `HttpTransport` на тех же декларациях. Импорт идёт
 * через `./index.js`: satellite видит ровно то, что видит внешний автор
 * транспорта. Не хватает части — экспорт добавляется в пакет, а не
 * обходной код сюда.
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';

import {
  assemblePayload,
  bindingNeedsBody,
  HTTP_CAPABILITIES,
  HTTP_TRANSPORT_NAME,
  httpBindingOf,
  httpEndpoint,
  HttpRouter,
  HttpTransport,
  parseJson,
  readQuery,
  sendResponse,
} from './index.js';

import type {
  EndpointMeta,
  Raw,
  TransportCapabilities,
} from '@nestling/pipeline';
import {
  assertFormsSupported,
  describeForm,
  makeEmptyContext,
  Ok,
} from '@nestling/pipeline';
import type { Dispatch, ITransport } from '@nestling/transport';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

/**
 * Транспорт поверх собственного `node:http`-сервера.
 *
 * Своего разбора и кадрирования у него нет: тело читает `parseJson`,
 * места полей дают `httpBindingOf`, `readQuery` и `assemblePayload`,
 * ответ пишет `sendResponse`. Формы io он объявляет тем же
 * `HTTP_CAPABILITIES`, что и `HttpTransport`.
 *
 * Формы `stream`, `events` и `multipart` satellite не обслуживает: для
 * границы пакета достаточно `GET` и `POST` со значениями.
 */
class SatelliteTransport implements ITransport {
  readonly capabilities: TransportCapabilities = HTTP_CAPABILITIES;

  private readonly router = new HttpRouter();
  private server?: Server;
  private dispatch?: Dispatch;
  private closeController?: AbortController;
  private port = 0;

  /** Фактический адрес; порт выбирает ОС */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    for (const route of dispatch.routes) {
      assertFormsSupported(route, this.capabilities);
      this.router.route(route);
    }

    this.dispatch = dispatch;
    this.closeController = new AbortController();
    signal.addEventListener('abort', () => void this.close(), { once: true });

    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      });
    });
    this.server = server;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.dispatch = undefined;
    this.closeController?.abort();
    this.closeController = undefined;

    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }

  /** Обрабатывает один запрос байтовыми частями пакета */
  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const match = this.router.find(req);
    const dispatch = this.dispatch;

    if (!match || !dispatch) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`,
    );

    const binding = httpBindingOf(match.declaration);
    const body = bindingNeedsBody(binding) ? await parseJson(req) : undefined;

    const payload = assemblePayload(binding, {
      query: readQuery(url.searchParams, binding.fields),
      body,
      params: match.params,
    });

    const raw: Raw = {
      transport: HTTP_TRANSPORT_NAME,
      pattern: `${req.method || 'GET'} ${url.pathname}`,
      payload,
      attributes: req.headers as Record<string, string>,
    };

    const endpoint: EndpointMeta = {
      transport: HTTP_TRANSPORT_NAME,
      pattern: match.declaration.pattern,
      input: match.declaration.input,
      output: match.declaration.output,
      errors: match.declaration.errors,
    };

    const ctx = makeEmptyContext(raw, endpoint, this.closeController?.signal);

    const response = await dispatch.call(match.declaration.pattern, ctx);

    await sendResponse(res, response, {
      kind: describeForm(match.declaration.output).kind,
      summary: ctx.summary,
    });
  }
}

const User = z.object({ id: z.string(), name: z.string() });

const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }),
  output: User,
  handler: ({ id }) => new Ok({ id, name: `user-${id}` }),
});

const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  input: z.object({ name: z.string() }),
  output: User,
  handler: ({ name }) => Ok.created({ id: 'u-1', name }),
});

/** Ответ, сведённый к сравнимому виду: satellite и транспорт дают один */
interface Answer {
  status: number;
  contentType: string | null;
  body: unknown;
}

async function answerOf(response: Response): Promise<Answer> {
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body: await response.json(),
  };
}

describe('satellite-транспорт поверх байтовых частей пакета', () => {
  let satellite: SatelliteTransport;
  let reference: HttpTransport;
  let controller: AbortController;
  let referenceUrl: string;

  beforeAll(async () => {
    controller = new AbortController();

    satellite = new SatelliteTransport();
    await satellite.serve(
      makeDispatch([GetUser, CreateUser]),
      controller.signal,
    );

    reference = new HttpTransport({ port: 0, host: '127.0.0.1' });
    await reference.serve(
      makeDispatch([GetUser, CreateUser]),
      controller.signal,
    );

    const address = reference.address();
    if (!address) {
      throw new Error('transport did not report an address after serve()');
    }
    referenceUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await satellite.close();
    await reference.close();
  });

  it('объявляет формы io тем же значением, что HttpTransport', () => {
    expect(satellite.capabilities).toBe(reference.capabilities);
    expect(satellite.capabilities).toBe(HTTP_CAPABILITIES);
  });

  it('GET с JSON-ответом даёт то же, что HttpTransport', async () => {
    const [fromSatellite, fromTransport] = await Promise.all([
      fetch(`${satellite.baseUrl}/users/42`).then(answerOf),
      fetch(`${referenceUrl}/users/42`).then(answerOf),
    ]);

    expect(fromSatellite.body).toEqual({ id: '42', name: 'user-42' });
    expect(fromSatellite).toEqual(fromTransport);
  });

  it('POST с телом даёт то же, что HttpTransport', async () => {
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    };

    const [fromSatellite, fromTransport] = await Promise.all([
      fetch(`${satellite.baseUrl}/users`, request).then(answerOf),
      fetch(`${referenceUrl}/users`, request).then(answerOf),
    ]);

    expect(fromSatellite.status).toBe(201);
    expect(fromSatellite.body).toEqual({ id: 'u-1', name: 'Alice' });
    expect(fromSatellite).toEqual(fromTransport);
  });

  it('отказ проверки входа даёт тот же 400, что HttpTransport', async () => {
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 7 }),
    };

    const [fromSatellite, fromTransport] = await Promise.all([
      fetch(`${satellite.baseUrl}/users`, request).then(answerOf),
      fetch(`${referenceUrl}/users`, request).then(answerOf),
    ]);

    expect(fromSatellite.status).toBe(400);
    expect(fromSatellite).toEqual(fromTransport);
  });
});
