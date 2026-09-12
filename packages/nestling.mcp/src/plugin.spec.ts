/**
 * Плагин: точка построения определений, состав графа и подача endpoint'ов.
 *
 * Главное здесь — **когда** строятся определения. Нарушение объявления
 * роняет старт до `serve`, а не при первом запросе агента. Проверяется это
 * наблюдаемо: транспорт не начал принимать запросы.
 */

import { mcp, McpTools$ } from './plugin.js';
import { tool } from './tool.js';

import { describe, expect, it } from '@jest/globals';
import type {
  Dispatch,
  ITransport,
  TransportCapabilities,
} from '@nestlingjs/app';
import { implement, makeApp, makeFeature, Ok, transportValue } from '@nestlingjs/app';
import { buildOpenApiDocument } from '@nestlingjs/openapi';
import { makeRequest } from '@nestlingjs/operations';
import { zodConverter } from '@nestlingjs/schema.zod';
import { assembleTest } from '@nestlingjs/testing';
import { httpEndpoint, HttpTransport$ } from '@nestlingjs/transport.http';
import { z } from 'zod';

const server = { name: 'users-service', version: '1.0.0' };
const converters = [zodConverter()];

const CreateUser = makeRequest({
  name: 'mcp-plugin-spec.users.create',
  input: z.object({ email: z.string() }),
  output: z.object({ id: z.string() }),
  doc: { summary: 'Create a user' },
});

const ClaimQuota = makeRequest({
  name: 'mcp-plugin-spec.quotas.claim',
  input: z.object({ tenant: z.string() }),
  output: z.object({ remaining: z.number() }),
  doc: { summary: 'Claim a quota slot' },
});

const Silent = makeRequest({
  name: 'mcp-plugin-spec.users.silent',
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

const UsersFeature = makeFeature({
  name: 'module:mcp-plugin-spec',
  endpoints: [
    implement(CreateUser, { handler: async () => new Ok({ id: 'u-1' }) }),
    // Обычный HTTP-endpoint рядом: по нему видно, что документ строится, а
    // endpoint'ов плагина в нём нет
    httpEndpoint.get('/users', {
      output: z.array(z.object({ id: z.string() })),
      handler: async () => new Ok([]),
    }),
    implement(ClaimQuota, { handler: async () => new Ok({ remaining: 1 }) }),
    implement(Silent, { handler: async () => new Ok({ ok: true }) }),
  ],
});

const CAPABILITIES: TransportCapabilities = {
  input: new Set(['value'] as const),
  output: new Set(['value'] as const),
};

/** Транспорт-шпион: сообщает, начал ли он принимать запросы */
class SpyTransport implements ITransport {
  serving = false;

  async serve(_dispatch: Dispatch): Promise<void> {
    this.serving = true;
  }

  async close(): Promise<void> {
    this.serving = false;
  }
}

const asHttpTransport = (transport: ITransport) =>
  transportValue(HttpTransport$('default'), transport, {
    capabilities: CAPABILITIES,
  });

describe('mcp(...) — плагин-сервер', () => {
  it('отвергает неизвестное поле словаря', () => {
    expect(() =>
      mcp({ server, tools: [], title: 'x' } as never),
    ).toThrow(/unknown field 'title'/);
  });

  it('требует имя и версию сервера', () => {
    expect(() => mcp({ server: { name: '' }, tools: [] } as never)).toThrow(
      /'server.name' is required/,
    );
  });

  it('роняет сборку на нарушении объявления, не открыв ни одного порта', async () => {
    const transport = new SpyTransport();
    const app = makeApp({
      features: [UsersFeature],
      plugins: [
        mcp({ server, converters, tools: [tool(Silent), tool(CreateUser)] }),
      ],
      transports: [asHttpTransport(transport)],
    }).assemble();

    await expect(app.run()).rejects.toThrow(
      /1 tool\(s\) cannot be exposed over MCP/,
    );
    expect(transport.serving).toBe(false);

    await app.close();
  });

  it('роняет сборку, когда конвертера для вендора схемы нет', async () => {
    const app = makeApp({
      features: [UsersFeature],
      plugins: [mcp({ server, tools: [tool(CreateUser)] })],
      transports: [asHttpTransport(new SpyTransport())],
    }).assemble();

    await expect(app.run()).rejects.toThrow(/no converter for that vendor/);

    await app.close();
  });

  it('строит определения на фазе ASSEMBLE и кладёт их в контейнер', async () => {
    const app = await assembleTest(
      makeApp({
        features: [UsersFeature],
        plugins: [mcp({ server, converters, tools: [tool(CreateUser)] })],
        transports: [asHttpTransport(new SpyTransport())],
      }),
    );

    expect(app.get(McpTools$)?.map((item) => item.definition.name)).toEqual([
      'mcp-plugin-spec_users_create',
    ]);

    await app.close();
  });

  it('не создаёт узла вызывателя для операции вне списка tools', async () => {
    const app = await assembleTest(
      makeApp({
        features: [UsersFeature],
        plugins: [mcp({ server, converters, tools: [tool(CreateUser)] })],
        transports: [asHttpTransport(new SpyTransport())],
      }),
    );

    expect(app.get(CreateUser.caller)).not.toBeNull();
    expect(app.get(ClaimQuota.caller)).toBeNull();

    await app.close();
  });

  it('не показывает свои endpoint’ы в документе OpenAPI', () => {
    const { endpoints } = makeApp({
      features: [UsersFeature],
      plugins: [mcp({ server, converters, tools: [tool(CreateUser)] })],
      transports: [asHttpTransport(new SpyTransport())],
    }).discover();

    const document = buildOpenApiDocument(endpoints, {
      info: { title: 'Users API', version: '1.0.0' },
      converters,
    });

    expect(Object.keys(document.paths)).toEqual(['/users']);
  });

  it('объявляет endpoint’ы по заданному пути', () => {
    const { endpoints } = makeApp({
      features: [UsersFeature],
      plugins: [
        mcp({ server, converters, tools: [tool(CreateUser)], path: '/agent' }),
      ],
      transports: [asHttpTransport(new SpyTransport())],
    }).discover();

    const patterns = endpoints
      .filter((endpoint) => endpoint.moduleName === '@nestlingjs/mcp')
      .map(({ endpoint }) => endpoint.pattern)
      .sort();

    expect(patterns).toEqual(['DELETE /agent', 'POST /agent']);
  });
});
