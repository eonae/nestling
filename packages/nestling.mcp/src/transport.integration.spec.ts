/**
 * Транспорт на настоящем сокете: какие запросы он берёт и чем отвечает.
 *
 * Сокет здесь принадлежит `HttpServer`, как и в собранном приложении:
 * транспорт присоединяет обработчик в `serve`, а сервер открывает порт
 * следующим шагом. Что берётся, а что уходит дальше по цепочке, иначе чем
 * запросом не проверить.
 */

import { request } from 'node:http';

import type { McpRuntimeOptions } from './options.js';
import {
  DEFAULT_PATH,
  DEFAULT_SESSION_IDLE_MS,
  DEFAULT_SESSION_LIMIT,
} from './options.js';
import { mcpTool } from './tool.js';
import { McpTransport } from './transport.js';

import { afterEach, describe, expect, it } from '@jest/globals';
import type { ExecutableDeclaration } from '@nestlingjs/app';
import { makeDispatch, Ok } from '@nestlingjs/app';
import { zodConverter } from '@nestlingjs/schema.zod';
import { HttpServer } from '@nestlingjs/transport.http';
import { z } from 'zod';

const Echo = mcpTool('echo', {
  description: 'Вернуть то, что пришло.',
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string() }),
  handler: ({ text }) => new Ok({ text }),
});

/** Ответ сервера: код, заголовки и тело текстом */
interface Answer {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

/** Поднятый транспорт вместе со своим сервером */
interface Running {
  readonly transport: McpTransport;
  readonly server: HttpServer;
  readonly port: number;
}

let running: Running | undefined;

/** Опции транспорта с умолчаниями пакета */
function options(
  overrides: Partial<McpRuntimeOptions> = {},
): McpRuntimeOptions {
  return {
    info: { name: 'spec-server', version: '1.0.0' },
    path: DEFAULT_PATH,
    sessionLimit: DEFAULT_SESSION_LIMIT,
    sessionIdleMs: DEFAULT_SESSION_IDLE_MS,
    ...overrides,
  };
}

/** Поднимает транспорт на эфемерном порту loopback-адреса */
async function start(
  tools: ExecutableDeclaration[] = [Echo],
  overrides: Partial<McpRuntimeOptions> = {},
): Promise<Running> {
  const server = new HttpServer({ port: 0, host: '127.0.0.1' });
  const transport = new McpTransport(server, options(overrides), [
    zodConverter(),
  ]);

  await transport.serve(makeDispatch(tools), new AbortController().signal);
  await server.listen();

  const address = server.address();
  if (!address) {
    throw new Error('server did not report an address after listen()');
  }

  running = { transport, server, port: address.port };

  return running;
}

/** Шлёт один запрос и читает ответ целиком */
function call(
  port: number,
  method: string,
  path: string,
  options: { body?: string; headers?: Record<string, string> } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'content-type': 'application/json',
          ...options.headers,
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );

    req.on('error', reject);
    req.end(options.body);
  });
}

/** Открывает сессию и возвращает её идентификатор */
async function openSession(port: number): Promise<string> {
  const answer = await call(port, 'POST', DEFAULT_PATH, {
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });

  const sessionId = answer.headers['mcp-session-id'];
  if (typeof sessionId !== 'string') {
    throw new TypeError('initialize did not return a session id');
  }

  return sessionId;
}

afterEach(async () => {
  if (running) {
    await running.server.drain();
    await running.transport.close();
    running = undefined;
  }
});

describe('запросы, которые транспорт берёт', () => {
  it('отвечает на POST сообщением JSON-RPC со статусом 200', async () => {
    const { port } = await start();

    const answer = await call(port, 'POST', DEFAULT_PATH, {
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {},
    });
  });

  it('отвечает на нотификацию статусом 202 без тела', async () => {
    const { port } = await start();

    const answer = await call(port, 'POST', DEFAULT_PATH, {
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });

    expect(answer.status).toBe(202);
    expect(answer.body).toBe('');
  });

  it('отдаёт идентификатор сессии заголовком на initialize', async () => {
    const { port } = await start();
    const sessionId = await openSession(port);

    expect(sessionId).toMatch(/[\da-f-]{36}/);
  });

  it('закрывает сессию по DELETE', async () => {
    const { port, transport } = await start();
    const sessionId = await openSession(port);

    const answer = await call(port, 'DELETE', DEFAULT_PATH, {
      headers: { 'mcp-session-id': sessionId },
    });

    expect(answer.status).toBe(204);
    expect(transport.openSessions).toBe(0);
  });

  it('отвечает отказом not_found на DELETE неизвестной сессии', async () => {
    const { port } = await start();

    const answer = await call(port, 'DELETE', DEFAULT_PATH, {
      headers: { 'mcp-session-id': 'no-such-session' },
    });

    expect(answer.status).toBe(404);
    expect(JSON.parse(answer.body)).toMatchObject({
      code: 'not_found:mcp_session',
    });
  });

  it('исполняет инструмент пайплайном его декларации', async () => {
    const { port } = await start();
    const sessionId = await openSession(port);

    const answer = await call(port, 'POST', DEFAULT_PATH, {
      headers: { 'mcp-session-id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'привет' } },
      }),
    });

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body).result).toMatchObject({
      structuredContent: { text: 'привет' },
    });
  });

  it('берёт сообщения по пути из опции', async () => {
    const { port } = await start([Echo], { path: '/agent' });

    const taken = await call(port, 'POST', '/agent', {
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    const missed = await call(port, 'POST', DEFAULT_PATH, {
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });

    expect(taken.status).toBe(200);
    expect(missed.status).toBe(404);
  });
});

describe('запросы, которые транспорт не берёт', () => {
  it('не берёт GET: потока событий у сервера нет', async () => {
    const { port } = await start();

    const answer = await call(port, 'GET', DEFAULT_PATH);

    expect(answer.status).toBe(404);
  });

  it('не берёт чужой путь', async () => {
    const { port } = await start();

    const answer = await call(port, 'POST', '/users', {
      body: '{}',
    });

    expect(answer.status).toBe(404);
  });
});

describe('старт транспорта', () => {
  it('падает на нарушении объявления до открытия сокета', async () => {
    const Nameless = mcpTool('nameless', {
      description: '',
      input: z.object({ id: z.string() }),
      handler: () => new Ok(null),
    });

    const server = new HttpServer({ port: 0, host: '127.0.0.1' });
    const transport = new McpTransport(server, options(), [zodConverter()]);

    await expect(
      transport.serve(makeDispatch([Nameless]), new AbortController().signal),
    ).rejects.toThrow(/tool 'nameless': it has no description/);

    expect(server.address()).toBeNull();
    await server.release();
  });

  it('отвергает вторую попытку обслуживать', async () => {
    const { transport } = await start();

    await expect(
      transport.serve(makeDispatch([Echo]), new AbortController().signal),
    ).rejects.toThrow(/already serving/);
  });

  it('чистит сессии на close', async () => {
    const { port, transport } = await start();
    await openSession(port);

    expect(transport.openSessions).toBe(1);

    await transport.close();

    expect(transport.openSessions).toBe(0);
  });
});
