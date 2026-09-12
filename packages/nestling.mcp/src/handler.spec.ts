/**
 * Обработчик сообщений: конверт JSON-RPC, пять методов, сессия и версия.
 *
 * Приложение здесь не поднимается: обработчик принимает тело с заголовками
 * и возвращает то, чем на него отвечать.
 */

import { buildToolDefinitions } from './definitions.js';
import type { BoundTool, McpContext, McpOutcome } from './handler.js';
import { handleMessage, SESSION_HEADER, VERSION_HEADER } from './handler.js';
import type { McpRuntimeOptions } from './options.js';
import { DEFAULT_SESSION_IDLE_MS, DEFAULT_SESSION_LIMIT } from './options.js';
import { JsonRpcErrorCode } from './protocol.js';
import { McpSessions } from './sessions.js';
import { tool } from './tool.js';

import { describe, expect, it } from '@jest/globals';
import { Ok } from '@nestlingjs/app';
import { makeFail, makeRequest } from '@nestlingjs/operations';
import { zodConverter } from '@nestlingjs/schema.zod';
import { z } from 'zod';

const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} is already taken`,
});

const CreateUser = makeRequest({
  name: 'mcp-handler-spec.users.create',
  input: z.object({ email: z.string() }),
  output: z.object({ id: z.string() }),
  errors: [EmailTaken],
  doc: { summary: 'Create a user' },
});

const options: McpRuntimeOptions = {
  server: { name: 'users-service', version: '1.0.0' },
  sessionLimit: DEFAULT_SESSION_LIMIT,
  sessionIdleMs: DEFAULT_SESSION_IDLE_MS,
};

/** Инструмент с портом-заглушкой: вызов возвращает заранее заданный ответ */
function boundTool(answer: unknown, calls: unknown[] = []): BoundTool {
  const [definition] = buildToolDefinitions([tool(CreateUser)], {
    converters: [zodConverter()],
  });

  return {
    ...definition,
    port: {
      call: (payload?: unknown) => {
        calls.push(payload);
        return Promise.resolve(answer as never);
      },
    },
  };
}

async function contextOf(
  overrides: Partial<McpRuntimeOptions> = {},
  tools: BoundTool[] = [],
): Promise<McpContext> {
  const runtime = { ...options, ...overrides };

  return {
    tools,
    options: runtime,
    sessions: await McpSessions.acquire(runtime, new AbortController().signal),
  };
}

/** Шлёт сообщение и возвращает исход */
function send(
  body: unknown,
  context: McpContext,
  headers: Record<string, string> = {},
): Promise<McpOutcome> {
  return handleMessage(
    {
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers,
      signal: new AbortController().signal,
    },
    context,
  );
}

/** Открывает сессию и возвращает заголовки последующих запросов */
async function opened(context: McpContext): Promise<Record<string, string>> {
  const outcome = await send(
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: {} },
    context,
  );

  if (outcome.kind !== 'response' || outcome.sessionId === undefined) {
    throw new Error('initialize did not open a session');
  }

  return { [SESSION_HEADER]: outcome.sessionId };
}

describe('конверт JSON-RPC', () => {
  it('отвечает на запрос ответом с тем же идентификатором', async () => {
    const context = await contextOf();
    const outcome = await send(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      context,
    );

    expect(outcome).toEqual({
      kind: 'response',
      body: { jsonrpc: '2.0', id: 1, result: {} },
    });
  });

  it('принимает нотификацию без тела ответа', async () => {
    const context = await contextOf();

    expect(
      await send(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        context,
      ),
    ).toEqual({ kind: 'accepted' });
  });

  it('отвечает кодом ошибки разбора на дефектный JSON', async () => {
    const context = await contextOf();
    const outcome = await send('{ not json', context);

    expect(outcome).toMatchObject({
      kind: 'response',
      body: { id: null, error: { code: JsonRpcErrorCode.ParseError } },
    });
  });

  it('отвергает пачку сообщений', async () => {
    const context = await contextOf();
    const outcome = await send([{ jsonrpc: '2.0', id: 1 }], context);

    expect(outcome).toMatchObject({
      body: { error: { code: JsonRpcErrorCode.InvalidRequest } },
    });
  });

  it('отвергает тело без поля jsonrpc', async () => {
    const context = await contextOf();
    const outcome = await send({ id: 1, method: 'ping' }, context);

    expect(outcome).toMatchObject({
      body: { id: 1, error: { code: JsonRpcErrorCode.InvalidRequest } },
    });
  });

  it('отвергает тело без поля method', async () => {
    const context = await contextOf();
    const outcome = await send({ jsonrpc: '2.0', id: 1 }, context);

    expect(outcome).toMatchObject({
      body: { error: { code: JsonRpcErrorCode.InvalidRequest } },
    });
  });

  it('отвечает «метод не найден» на неизвестный метод', async () => {
    const context = await contextOf();
    const outcome = await send(
      { jsonrpc: '2.0', id: 2, method: 'resources/list' },
      context,
    );

    expect(outcome).toMatchObject({
      body: { id: 2, error: { code: JsonRpcErrorCode.MethodNotFound } },
    });
  });
});

describe('методы протокола', () => {
  it('initialize объявляет один tools и сведения о сервере', async () => {
    const context = await contextOf();
    const outcome = await send(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          clientInfo: { name: 'claude', version: '1.0.0' },
        },
      },
      context,
    );

    expect(outcome).toMatchObject({
      kind: 'response',
      body: {
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'users-service', version: '1.0.0' },
        },
      },
    });
    expect((outcome as { sessionId?: string }).sessionId).toEqual(
      expect.any(String),
    );
  });

  it('initialize отвечает последней версией на неизвестную', async () => {
    const context = await contextOf();
    const outcome = await send(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '1999-01-01' },
      },
      context,
    );

    expect(outcome).toMatchObject({
      body: { result: { protocolVersion: '2025-06-18' } },
    });
  });

  it('initialize сверх предела отдаёт отказ, называющий предел', async () => {
    const context = await contextOf({ sessionLimit: 1 });
    await opened(context);

    const outcome = await send(
      { jsonrpc: '2.0', id: 2, method: 'initialize' },
      context,
    );

    expect(outcome.kind).toBe('fail');
    expect((outcome as { fail: Error }).fail.message).toMatch(
      /already holds 1 open MCP session/,
    );
  });

  it('tools/list отдаёт все объявленные инструменты', async () => {
    const context = await contextOf({}, [boundTool(new Ok({ id: 'u-1' }))]);
    const headers = await opened(context);

    const outcome = await send(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      context,
      headers,
    );

    expect(outcome).toMatchObject({
      body: {
        result: {
          tools: [
            {
              name: 'mcp-handler-spec_users_create',
              description: 'Create a user',
              inputSchema: { type: 'object' },
            },
          ],
        },
      },
    });
  });

  it('tools/call зовёт порт и отдаёт успех структурой', async () => {
    const calls: unknown[] = [];
    const context = await contextOf({}, [
      boundTool(new Ok({ id: 'u-1' }), calls),
    ]);
    const headers = await opened(context);

    const outcome = await send(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'mcp-handler-spec_users_create',
          arguments: { email: 'a@b.c' },
        },
      },
      context,
      headers,
    );

    expect(calls).toEqual([{ email: 'a@b.c' }]);
    expect(outcome).toMatchObject({
      body: { result: { structuredContent: { id: 'u-1' } } },
    });
  });

  it('tools/call отдаёт отказ операции результатом, а не ошибкой', async () => {
    const context = await contextOf({}, [
      boundTool(EmailTaken({ email: 'a@b.c' })),
    ]);
    const headers = await opened(context);

    const outcome = await send(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'mcp-handler-spec_users_create', arguments: {} },
      },
      context,
      headers,
    );

    expect(outcome).toMatchObject({
      body: { result: { isError: true } },
    });
    expect(outcome).not.toHaveProperty('body.error');
  });

  it('tools/call с неизвестным именем отвечает «неверные параметры»', async () => {
    const context = await contextOf({}, [boundTool(new Ok({ id: 'u-1' }))]);
    const headers = await opened(context);

    const outcome = await send(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'nope' },
      },
      context,
      headers,
    );

    expect(outcome).toMatchObject({
      body: {
        error: { code: JsonRpcErrorCode.InvalidParams, message: /nope/ as never },
      },
    });
  });
});

describe('сессия и версия протокола', () => {
  it('обслуживает второй запрос по выданной сессии, не заводя новой', async () => {
    const context = await contextOf();
    const headers = await opened(context);

    const outcome = await send(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      context,
      headers,
    );

    expect(outcome.kind).toBe('response');
    expect(context.sessions.size).toBe(1);
  });

  it('отвечает not_found на неизвестную сессию', async () => {
    const context = await contextOf();
    const outcome = await send(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      context,
      { [SESSION_HEADER]: 'missing' },
    );

    expect(outcome.kind).toBe('fail');
    expect((outcome as { fail: { code: string } }).fail.code).toBe(
      'not_found:mcp_session',
    );
  });

  it('требует заголовок сессии для tools/list', async () => {
    const context = await contextOf();
    const outcome = await send(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      context,
    );

    expect((outcome as { fail: { code: string } }).fail.code).toBe(
      'bad_request',
    );
  });

  it('отвечает bad_request на версию протокола вне списка', async () => {
    const context = await contextOf();
    const outcome = await send(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      context,
      { [VERSION_HEADER]: '1999-01-01' },
    );

    expect(outcome.kind).toBe('fail');
    expect((outcome as { fail: { code: string } }).fail.code).toBe(
      'bad_request',
    );
  });

  it('пропускает запрос с поддерживаемой версией протокола', async () => {
    const context = await contextOf();
    const outcome = await send(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      context,
      { [VERSION_HEADER]: '2025-03-26' },
    );

    expect(outcome.kind).toBe('response');
  });
});
