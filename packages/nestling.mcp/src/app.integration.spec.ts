/**
 * Приложение целиком: настоящий клиент SDK, два протокола на одном сокете
 * и одна операция на двух поверхностях.
 *
 * Ответ сервера здесь проверяет реализация клиента из
 * `@modelcontextprotocol/sdk`, а не наши ожидания: соответствие протоколу
 * нашими же тестами по нашему же прочтению спецификации не доказывается.
 * Клиент соединяется по HTTP, поэтому проверяется путь целиком.
 */

import { McpTransport$ } from './token.js';
import { mcpTool } from './tool.js';
import { mcp } from './transport.js';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Binding, BuiltApp, ConfigSource } from '@nestlingjs/app';
import { bind, makeApp, makeFail, makeFeature, Ok } from '@nestlingjs/app';
import { Handler, makeModule } from '@nestlingjs/container';
import { openapi } from '@nestlingjs/openapi';
import { makeRequest } from '@nestlingjs/operations';
import type { HttpServer } from '@nestlingjs/transport.http';
import {
  http,
  httpEndpoint,
  server,
  serverKeys,
} from '@nestlingjs/transport.http';
import { z } from 'zod';

const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} is already taken`,
});

/** Операция с адресом по HTTP: её обслуживают обе поверхности сразу */
const CreateUser = makeRequest({
  name: 'mcp-app-spec.users.create',
  http: 'POST /users',
  input: z.object({ email: z.string() }),
  output: z.object({ id: z.string(), email: z.string() }),
  errors: [EmailTaken],
  doc: { summary: 'Создать пользователя по адресу почты.' },
});

/** Один класс-хендлер на обе поверхности операции */
@Handler([])
class CreateUserHandler {
  handle({ email }: { email: string }) {
    return email === 'taken@b.c'
      ? EmailTaken({ email })
      : new Ok({ id: 'u-1', email });
  }
}

const CountUsers = mcpTool('count_users', {
  description: 'Сосчитать пользователей.',
  output: z.object({ total: z.number() }),
  handler: () => new Ok({ total: 7 }),
});

const UsersModule = makeModule({ name: 'module:users' });

const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  endpoints: [
    httpEndpoint.implement(CreateUser, { handler: CreateUserHandler }),
    mcpTool.implement(CreateUser, {
      annotations: { idempotentHint: false },
      handler: CreateUserHandler,
    }),
    CountUsers,
  ],
});

/** Порт выбирает ОС, адрес — loopback: сокет теста никуда не смотрит */
const socketValues: Record<string, string> = {
  HTTP_PORT: '0',
  HTTP_HOST: '127.0.0.1',
};
const socket: ConfigSource = {
  name: 'test-socket',
  get: (key) => socketValues[key],
};
const config: readonly Binding[] = [bind(socket, { keys: serverKeys() })];

/** Один сервер на два протокола: объявление сервера общее */
const api = server();

/** Декларация приложения: из неё берётся и discovery, и сборка */
const spec = makeApp({
  features: [UsersFeature],
  transports: [
    http({ server: api }),
    mcp({
      server: api,
      info: { name: 'users-service', version: '1.0.0' },
    }),
  ],
});

let app: BuiltApp;
let baseUrl: string;
let client: Client;

beforeAll(async () => {
  app = spec.build();
  await app.run({ config });

  const instance = app.servers.get('default') as HttpServer | undefined;

  if (!instance) {
    throw new Error('server is not listening');
  }

  baseUrl = instance.baseUrl();

  client = new Client({ name: 'spec-client', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)),
  );
});

afterAll(async () => {
  await client?.close();
  await app?.close();
});

describe('клиент SDK на поднятом приложении', () => {
  it('получает перечень объявленных инструментов', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'count_users',
      'mcp-app-spec_users_create',
    ]);
  });

  it('получает описание и схему входа инструмента', async () => {
    const { tools } = await client.listTools();
    const create = tools.find(
      (tool) => tool.name === 'mcp-app-spec_users_create',
    );

    expect(create?.description).toBe('Создать пользователя по адресу почты.');
    expect(create?.inputSchema).toMatchObject({
      type: 'object',
      properties: { email: { type: 'string' } },
    });
    expect(create?.annotations).toEqual({ idempotentHint: false });
  });

  it('вызывает инструмент и читает структурированный ответ', async () => {
    const result = await client.callTool({
      name: 'mcp-app-spec_users_create',
      arguments: { email: 'a@b.c' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ id: 'u-1', email: 'a@b.c' });
  });

  it('читает отказ операции результатом вызова, а не ошибкой вызова', async () => {
    const result = await client.callTool({
      name: 'mcp-app-spec_users_create',
      arguments: { email: 'taken@b.c' },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('conflict:email_taken');
  });

  it('читает отказ проверки входа тем же результатом', async () => {
    const result = await client.callTool({
      name: 'mcp-app-spec_users_create',
      arguments: { email: 42 },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('bad_request');
  });
});

describe('две поверхности одной операции', () => {
  it('обслуживает операцию и по HTTP, и инструментом', async () => {
    const response = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c' }),
    });

    const fromHttp = await response.json();
    const fromTool = await client.callTool({
      name: 'mcp-app-spec_users_create',
      arguments: { email: 'a@b.c' },
    });

    expect(response.status).toBe(200);
    expect(fromHttp).toEqual({ id: 'u-1', email: 'a@b.c' });
    expect(fromTool.structuredContent).toEqual(fromHttp);
  });
});

describe('состав документа OpenAPI', () => {
  it('не описывает инструменты: у них нет адреса по HTTP', () => {
    const document = openapi({
      info: { title: 'Users API', version: '1.0.0' },
    }).document(spec.discover());

    expect(Object.keys(document.paths)).toEqual(['/users']);
    expect(JSON.stringify(document)).not.toContain('count_users');
  });

  it('показывает инструменты в discovery на их транспорте', () => {
    const onMcp = spec.discover().transports.get(McpTransport$('default'));

    expect(onMcp?.map(({ endpoint }) => endpoint.pattern).sort()).toEqual([
      'count_users',
      'mcp-app-spec_users_create',
    ]);
  });
});
