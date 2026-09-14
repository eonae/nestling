/**
 * Обработчик сообщений протокола: пять методов, конверт и сессии.
 *
 * Приложение здесь не поднимается: обработчик получает тело с заголовками
 * и возвращает то, чем на него отвечать. Проверяется он теми же данными,
 * какие получит от транспорта.
 */

import { buildToolDefinitions } from './definitions.js';
import type { McpContext, McpOutcome, McpRequest } from './handler.js';
import {
  closeSession,
  handleMessage,
  SESSION_HEADER,
  VERSION_HEADER,
} from './handler.js';
import { JsonRpcErrorCode, LATEST_PROTOCOL_VERSION } from './protocol.js';
import { McpSessions } from './sessions.js';
import { mcpTool } from './tool.js';

import type { AnyFail } from '@nestlingjs/app';
import { Fail, makeDispatch, makeFail, Ok } from '@nestlingjs/app';
import { zodConverter } from '@nestlingjs/schema.zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} is already taken`,
});

const CreateUser = mcpTool('create_user', {
  description: 'Создать пользователя.',
  input: z.object({ email: z.string() }),
  output: z.object({ id: z.string() }),
  errors: [EmailTaken],
  handler: ({ email }) =>
    email === 'taken@b.c' ? EmailTaken({ email }) : new Ok({ id: 'u-1' }),
});

const Boom = mcpTool('boom', {
  description: 'Бросает необъявленную ошибку.',
  output: z.object({ ok: z.boolean() }),
  handler: () => {
    throw new Error('secret internals');
  },
});

/** Контекст обработчика: инструменты, сессии, опции и диспетчер */
function makeContext(sessionLimit = 100): McpContext {
  const dispatch = makeDispatch([CreateUser, Boom]);

  return {
    dispatch,
    tools: buildToolDefinitions(dispatch.routes, {
      converters: [zodConverter()],
    }),
    sessions: new McpSessions({ sessionLimit, sessionIdleMs: 60_000 }),
    options: {
      info: { name: 'users-service', version: '1.0.0' },
      path: '/mcp',
      sessionLimit,
      sessionIdleMs: 60_000,
    },
  };
}

/** Запрос к обработчику: тело сообщения и заголовки */
function makeRequest(
  message: unknown,
  headers: Record<string, string> = {},
): McpRequest {
  return {
    body: typeof message === 'string' ? message : JSON.stringify(message),
    headers,
    signal: new AbortController().signal,
  };
}

/** Открывает сессию и возвращает её идентификатор */
async function openSession(context: McpContext): Promise<string> {
  const outcome = await handleMessage(
    makeRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        clientInfo: { name: 'spec-client', version: '0.0.1' },
      },
    }),
    context,
  );

  if (outcome.kind !== 'response' || outcome.sessionId === undefined) {
    throw new Error(`initialize did not open a session: ${outcome.kind}`);
  }

  return outcome.sessionId;
}

/** Тело успешного ответа JSON-RPC */
function resultOf(outcome: McpOutcome): Record<string, unknown> {
  if (outcome.kind !== 'response' || !('result' in outcome.body)) {
    throw new Error(`outcome is not a JSON-RPC result: ${outcome.kind}`);
  }

  return outcome.body.result;
}

/** Ошибка протокола из ответа */
function errorOf(outcome: McpOutcome): { code: number; message: string } {
  if (outcome.kind !== 'response' || !('error' in outcome.body)) {
    throw new Error(`outcome is not a JSON-RPC error: ${outcome.kind}`);
  }

  return outcome.body.error;
}

/** Отказ транспорта из исхода */
function failOf(outcome: McpOutcome): AnyFail {
  if (outcome.kind !== 'fail') {
    throw new Error(`outcome is not a fail: ${outcome.kind}`);
  }

  return outcome.fail;
}

describe('initialize', () => {
  it('отвечает сведениями о сервере и заводит сессию', async () => {
    const context = makeContext();
    const outcome = await handleMessage(
      makeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      context,
    );

    expect(resultOf(outcome)).toMatchObject({
      protocolVersion: LATEST_PROTOCOL_VERSION,
      serverInfo: { name: 'users-service', version: '1.0.0' },
    });
    expect(context.sessions.size).toBe(1);
  });

  it('объявляет одну возможность — инструменты', async () => {
    const outcome = await handleMessage(
      makeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      makeContext(),
    );

    expect(resultOf(outcome).capabilities).toEqual({ tools: {} });
  });

  it('отвечает последней поддерживаемой версией на незнакомую', async () => {
    const outcome = await handleMessage(
      makeRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '1999-01-01' },
      }),
      makeContext(),
    );

    expect(resultOf(outcome).protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  it('отказывает сверх предела сессий, называя предел', async () => {
    const context = makeContext(1);
    await openSession(context);

    const outcome = await handleMessage(
      makeRequest({ jsonrpc: '2.0', id: 2, method: 'initialize' }),
      context,
    );

    expect(failOf(outcome).code).toBe('too_many_requests:mcp_sessions');
    expect(failOf(outcome).message).toMatch(/already holds 1/);
  });
});

describe('ping и нотификации', () => {
  it('отвечает на ping пустым результатом', async () => {
    const outcome = await handleMessage(
      makeRequest({ jsonrpc: '2.0', id: 7, method: 'ping' }),
      makeContext(),
    );

    expect(outcome).toEqual({
      kind: 'response',
      body: { jsonrpc: '2.0', id: 7, result: {} },
    });
  });

  it('принимает нотификацию без ответа', async () => {
    const outcome = await handleMessage(
      makeRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      makeContext(),
    );

    expect(outcome).toEqual({ kind: 'accepted' });
  });
});

describe('tools/list', () => {
  it('отдаёт определения всех инструментов транспорта', async () => {
    const context = makeContext();
    const sessionId = await openSession(context);

    const outcome = await handleMessage(
      makeRequest(
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { [SESSION_HEADER]: sessionId },
      ),
      context,
    );

    const { tools } = resultOf(outcome) as {
      tools: { name: string; description?: string }[];
    };

    expect(tools.map((tool) => tool.name)).toEqual(['create_user', 'boom']);
    expect(tools[0].description).toBe('Создать пользователя.');
  });

  it('отказывает без заголовка сессии', async () => {
    const outcome = await handleMessage(
      makeRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      makeContext(),
    );

    expect(failOf(outcome).code).toBe('bad_request');
  });

  it('отказывает на неизвестную сессию', async () => {
    const outcome = await handleMessage(
      makeRequest(
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { [SESSION_HEADER]: 'no-such-session' },
      ),
      makeContext(),
    );

    expect(failOf(outcome).code).toBe('not_found:mcp_session');
  });
});

describe('tools/call', () => {
  it('исполняет инструмент и отдаёт успех результатом вызова', async () => {
    const context = makeContext();
    const sessionId = await openSession(context);

    const outcome = await handleMessage(
      makeRequest(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'create_user', arguments: { email: 'a@b.c' } },
        },
        { [SESSION_HEADER]: sessionId },
      ),
      context,
    );

    expect(resultOf(outcome)).toEqual({
      content: [{ type: 'text', text: '{"id":"u-1"}' }],
      structuredContent: { id: 'u-1' },
    });
  });

  it('отдаёт объявленный отказ результатом вызова, а не ошибкой протокола', async () => {
    const context = makeContext();
    const sessionId = await openSession(context);

    const outcome = await handleMessage(
      makeRequest(
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'create_user', arguments: { email: 'taken@b.c' } },
        },
        { [SESSION_HEADER]: sessionId },
      ),
      context,
    );

    const result = resultOf(outcome) as {
      isError?: boolean;
      structuredContent?: unknown;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({
      code: 'conflict:email_taken',
      message: 'Email taken@b.c is already taken',
      details: { email: 'taken@b.c' },
    });
  });

  it('не раскрывает деталей необъявленной ошибки', async () => {
    const context = makeContext();
    const sessionId = await openSession(context);

    const outcome = await handleMessage(
      makeRequest(
        {
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: { name: 'boom' },
        },
        { [SESSION_HEADER]: sessionId },
      ),
      context,
    );

    const result = resultOf(outcome) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('internal_error');
    expect(result.content[0].text).not.toContain('secret internals');
  });

  it('отвергает неизвестное имя инструмента неверными параметрами', async () => {
    const context = makeContext();
    const sessionId = await openSession(context);

    const outcome = await handleMessage(
      makeRequest(
        {
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: { name: 'delete_everything' },
        },
        { [SESSION_HEADER]: sessionId },
      ),
      context,
    );

    expect(errorOf(outcome).code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(errorOf(outcome).message).toContain('delete_everything');
  });
});

describe('конверт и версия протокола', () => {
  it('отвечает «метод не найден» на метод вне перечня', async () => {
    const outcome = await handleMessage(
      makeRequest({ jsonrpc: '2.0', id: 8, method: 'resources/list' }),
      makeContext(),
    );

    expect(errorOf(outcome).code).toBe(JsonRpcErrorCode.MethodNotFound);
  });

  it('отвечает кодом разбора на дефектный JSON', async () => {
    const outcome = await handleMessage(
      makeRequest('{ not json'),
      makeContext(),
    );

    expect(errorOf(outcome).code).toBe(JsonRpcErrorCode.ParseError);
  });

  it('отказывает на версию протокола вне списка поддерживаемых', async () => {
    const outcome = await handleMessage(
      makeRequest(
        { jsonrpc: '2.0', id: 9, method: 'ping' },
        { [VERSION_HEADER]: '1999-01-01' },
      ),
      makeContext(),
    );

    expect(failOf(outcome)).toBeInstanceOf(Fail);
    expect(failOf(outcome).code).toBe('bad_request');
  });

  it('пропускает запрос с поддерживаемой версией в заголовке', async () => {
    const outcome = await handleMessage(
      makeRequest(
        { jsonrpc: '2.0', id: 10, method: 'ping' },
        { [VERSION_HEADER]: LATEST_PROTOCOL_VERSION },
      ),
      makeContext(),
    );

    expect(resultOf(outcome)).toEqual({});
  });
});

describe('closeSession(request, context)', () => {
  it('закрывает открытую сессию', async () => {
    const context = makeContext();
    const sessionId = await openSession(context);

    expect(
      closeSession(makeRequest('', { [SESSION_HEADER]: sessionId }), context),
    ).toEqual({ kind: 'closed' });
    expect(context.sessions.size).toBe(0);
  });

  it('отказывает на сессию, которой нет', () => {
    const context = makeContext();

    expect(
      failOf(closeSession(makeRequest('', { [SESSION_HEADER]: 'x' }), context))
        .code,
    ).toBe('not_found:mcp_session');
  });

  it('отказывает на запрос без заголовка сессии', () => {
    const context = makeContext();

    expect(failOf(closeSession(makeRequest(''), context)).code).toBe(
      'not_found:mcp_session',
    );
  });
});
