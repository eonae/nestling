/**
 * Построение определений: перевод схем и нарушения объявления.
 *
 * Нарушения сообщаются одним списком. Проверяется и это: два дефектных
 * инструмента дают одно сообщение, в котором названы оба.
 */

import { buildToolDefinitions } from './definitions.js';
import { tool } from './tool.js';

import { describe, expect, it } from '@jest/globals';
import { makeRequest, stream } from '@nestlingjs/operations';
import { zodConverter } from '@nestlingjs/schema.zod';
import { z } from 'zod';

const converters = [zodConverter()];

const CreateUser = makeRequest({
  name: 'mcp-definitions-spec.users.create',
  input: z.object({ email: z.string() }),
  output: z.object({ id: z.string() }),
  doc: { summary: 'Create a user' },
});

const CountUsers = makeRequest({
  name: 'mcp-definitions-spec.users.count',
  input: z.object({ tenant: z.string() }),
  output: z.number(),
  doc: { summary: 'Count users' },
});

const Ping = makeRequest({
  name: 'mcp-definitions-spec.ping',
  output: z.object({ pong: z.boolean() }),
  doc: { summary: 'Ping the service' },
});

const ImportUsers = makeRequest({
  name: 'mcp-definitions-spec.users.import',
  input: stream(z.object({ email: z.string() })),
  output: z.object({ imported: z.number() }),
  doc: { summary: 'Import users' },
});

const Silent = makeRequest({
  name: 'mcp-definitions-spec.users.silent',
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

describe('buildToolDefinitions(tools, options)', () => {
  it('переводит схему входа в объектную JSON Schema', () => {
    const [built] = buildToolDefinitions([tool(CreateUser)], { converters });

    expect(built.definition.inputSchema).toMatchObject({
      type: 'object',
      properties: { email: { type: 'string' } },
    });
  });

  it('объявляет схему выхода, когда она переводится в объектную', () => {
    const [built] = buildToolDefinitions([tool(CreateUser)], { converters });

    expect(built.definition.outputSchema).toMatchObject({ type: 'object' });
    expect(built.structured).toBe(true);
  });

  it('оставляет схему выхода необъявленной, когда выход не объектный', () => {
    const [built] = buildToolDefinitions([tool(CountUsers)], { converters });

    expect(built.definition.outputSchema).toBeUndefined();
    expect(built.structured).toBe(false);
  });

  it('даёт операции без входа пустую объектную схему', () => {
    const [built] = buildToolDefinitions([tool(Ping)], { converters });

    expect(built.definition.inputSchema).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('переносит имя, описание и подсказки в определение', () => {
    const [built] = buildToolDefinitions(
      [tool(CreateUser, { annotations: { idempotentHint: false } })],
      { converters },
    );

    expect(built.definition).toMatchObject({
      name: 'mcp-definitions-spec_users_create',
      description: 'Create a user',
      annotations: { idempotentHint: false },
    });
  });

  it('сообщает об отсутствии конвертера, называя инструмент и слот', () => {
    expect(() => buildToolDefinitions([tool(CreateUser)], {})).toThrow(
      /'input' schema is a 'zod' schema, and no converter for that vendor/,
    );
  });

  it('сообщает о непереводимой схеме', () => {
    const broken = zodConverter();
    const failing = {
      vendor: broken.vendor,
      toJsonSchema: () => {
        throw new Error('unrepresentable');
      },
    };

    expect(() =>
      buildToolDefinitions([tool(CreateUser)], { converters: [failing] }),
    ).toThrow(/could not be converted to JSON Schema: unrepresentable/);
  });

  it('сообщает о необъектном входе', () => {
    expect(() =>
      buildToolDefinitions([tool(ImportUsers)], { converters }),
    ).toThrow(/'input' is not an object form/);
  });

  it('сообщает об отсутствии описания, называя три места', () => {
    expect(() => buildToolDefinitions([tool(Silent)], { converters })).toThrow(
      /it has no description.*doc\.summary/s,
    );
  });

  it('отвергает имя, которое не принимает протокол', () => {
    expect(() =>
      buildToolDefinitions([tool(CreateUser, { name: 'users/create' })], {
        converters,
      }),
    ).toThrow(/its name does not match/);
  });

  it('называет подстановку точек причиной столкновения имён', () => {
    const Dotted = makeRequest({
      name: 'mcp-definitions-spec.collide.one',
      input: z.object({ id: z.string() }),
      doc: { summary: 'One' },
    });
    const Underscored = makeRequest({
      name: 'mcp-definitions-spec_collide_one',
      input: z.object({ id: z.string() }),
      doc: { summary: 'Two' },
    });

    expect(() =>
      buildToolDefinitions([tool(Dotted), tool(Underscored)], { converters }),
    ).toThrow(/derived from the operation name with dots replaced/);
  });

  it('сообщает два нарушения одним списком', () => {
    let message = '';

    try {
      buildToolDefinitions([tool(Silent), tool(ImportUsers)], { converters });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/^2 tool\(s\) cannot be exposed over MCP:/);
    expect(message).toContain('mcp-definitions-spec.users.silent');
    expect(message).toContain('mcp-definitions-spec.users.import');
  });
});
