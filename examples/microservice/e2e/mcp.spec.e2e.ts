/**
 * Инструменты агента на том же сокете, что HTTP-API.
 *
 * Приложение поднято целиком, порт один. Проверяется, что сообщения
 * протокола обслуживаются рядом с endpoint'ами HTTP и что слой проверки
 * токена работает на инструменте так же, как на HTTP-декларации:
 * заголовки запроса агента доходят до пайплайна обычным путём.
 */

import type { TestAppContext } from './helpers/test-app.js';
import {
  closeTestApp,
  createTestApp,
  describeWithDatabase,
  E2E_TOKEN,
} from './helpers/test-app.js';

import { afterAll, beforeAll, expect, it } from '@jest/globals';

let context: TestAppContext;
let sessionId: string;

/** Шлёт одно сообщение протокола и разбирает ответ */
async function send(
  message: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; sessionId: string | null; body: any }> {
  const response = await fetch(`${context.baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(message),
  });

  return {
    status: response.status,
    sessionId: response.headers.get('mcp-session-id'),
    body: response.status === 202 ? undefined : await response.json(),
  };
}

/** Заголовки запроса в открытой сессии */
const inSession = (extra: Record<string, string> = {}) => ({
  'mcp-session-id': sessionId,
  ...extra,
});

describeWithDatabase('MCP на сокете приложения', () => {
  beforeAll(async () => {
    context = await createTestApp();

    const initialized = await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });

    if (!initialized.sessionId) {
      throw new Error('initialize did not open a session');
    }

    sessionId = initialized.sessionId;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('отдаёт сведения о сервере на initialize', async () => {
    const { body } = await send({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });

    expect(body.result.serverInfo).toEqual({
      name: 'microservice',
      version: '1.0.0',
    });
    expect(body.result.capabilities).toEqual({ tools: {} });
  });

  it('перечисляет инструменты приложения', async () => {
    const { body } = await send(
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      inSession(),
    );

    expect(
      body.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(['users_get', 'users_create', 'search_users']);
  });

  it('исполняет инструмент и отдаёт структурированный ответ', async () => {
    const { body } = await send(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'users_get', arguments: { id: '1' } },
      },
      inSession(),
    );

    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent).toMatchObject({ id: '1' });
  });

  it('отдаёт отказ операции результатом вызова', async () => {
    const { body } = await send(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'users_get', arguments: { id: 'no-such-user' } },
      },
      inSession(),
    );

    expect(body.result.isError).toBe(true);
    expect(JSON.stringify(body.result.content)).toContain('not_found');
  });

  it('проверяет Bearer-токен слоем инструмента', async () => {
    const withoutToken = await send(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'users_create',
          arguments: { name: 'Dave', email: 'dave@example.com' },
        },
      },
      inSession(),
    );

    expect(JSON.stringify(withoutToken.body.result.content)).toContain(
      'unauthorized',
    );

    const withToken = await send(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'users_create',
          arguments: { name: 'Dave', email: 'dave@example.com' },
        },
      },
      inSession({ authorization: `Bearer ${E2E_TOKEN}` }),
    );

    expect(withToken.body.result.isError).toBeFalsy();
    expect(withToken.body.result.structuredContent).toMatchObject({
      email: 'dave@example.com',
    });
  });

  it('не берёт GET по своему пути', async () => {
    const response = await fetch(`${context.baseUrl}/mcp`);

    expect(response.status).toBe(404);
  });

  it('обслуживает HTTP-endpoint на том же порту', async () => {
    const response = await fetch(`${context.baseUrl}/users`);

    expect(response.status).toBe(200);
  });
});
