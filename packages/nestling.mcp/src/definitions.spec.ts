/**
 * Построение определений инструментов и диагностика объявления.
 *
 * Маршруты берутся у настоящего диспетчера: проекция декларации — это то,
 * что транспорт получает в `serve`, и строить её вручную значило бы
 * проверять не тот вход.
 */

import { buildToolDefinitions } from './definitions.js';
import { mcpTool } from './tool.js';

import type { ExecutableDeclaration } from '@nestlingjs/app';
import { makeDispatch, Ok } from '@nestlingjs/app';
import { zodConverter } from '@nestlingjs/schema.zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const converters = [zodConverter()];

/** Проекции маршрутов: то, что транспорт видит в `dispatch.routes` */
const routesOf = (...tools: ExecutableDeclaration[]) =>
  makeDispatch(tools).routes;

const Search = mcpTool('search_users', {
  description: 'Найти пользователей по подстроке в адресе почты.',
  input: z.object({ query: z.string() }),
  output: z.object({ total: z.number() }),
  annotations: { readOnlyHint: true },
  handler: () => new Ok({ total: 0 }),
});

const Ping = mcpTool('ping_service', {
  description: 'Проверить, что сервис отвечает.',
  output: z.object({ up: z.boolean() }),
  handler: () => new Ok({ up: true }),
});

const CountUsers = mcpTool('count_users', {
  description: 'Сосчитать пользователей.',
  input: z.object({ active: z.boolean() }),
  output: z.number(),
  handler: () => new Ok(1),
});

const Nameless = mcpTool('nameless_tool', {
  description: '',
  input: z.object({ id: z.string() }),
  handler: () => new Ok(null),
});

const Primitive = mcpTool('primitive_input', {
  description: 'Вход примитивом.',
  input: z.string(),
  handler: () => new Ok(null),
});

describe('buildToolDefinitions(routes, { converters })', () => {
  it('переводит схему входа в объектную JSON Schema', () => {
    const [tool] = buildToolDefinitions(routesOf(Search), { converters });

    expect(tool.definition.name).toBe('search_users');
    expect(tool.definition.inputSchema).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
    });
  });

  it('объявляет схему выхода при объектной форме выхода', () => {
    const [tool] = buildToolDefinitions(routesOf(Search), { converters });

    expect(tool.definition.outputSchema).toMatchObject({ type: 'object' });
    expect(tool.structured).toBe(true);
  });

  it('не объявляет схему выхода при необъектной форме', () => {
    const [tool] = buildToolDefinitions(routesOf(CountUsers), { converters });

    expect(tool.definition.outputSchema).toBeUndefined();
    expect(tool.structured).toBe(false);
  });

  it('даёт инструменту без входа пустую объектную схему', () => {
    const [tool] = buildToolDefinitions(routesOf(Ping), { converters });

    expect(tool.definition.inputSchema).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('переносит описание и подсказки в определение', () => {
    const [tool] = buildToolDefinitions(routesOf(Search), { converters });

    expect(tool.definition.description).toBe(
      'Найти пользователей по подстроке в адресе почты.',
    );
    expect(tool.definition.annotations).toEqual({ readOnlyHint: true });
  });

  it('сохраняет порядок объявления', () => {
    const built = buildToolDefinitions(routesOf(Search, Ping), { converters });

    expect(built.map((tool) => tool.pattern)).toEqual([
      'search_users',
      'ping_service',
    ]);
  });

  it('падает, когда вендора схемы не знает ни один конвертер', () => {
    expect(() => buildToolDefinitions(routesOf(Search), {})).toThrow(
      /tool 'search_users'.*'input' schema comes from vendor 'zod'/s,
    );
  });

  it('падает, когда у инструмента нет описания', () => {
    expect(() =>
      buildToolDefinitions(routesOf(Nameless), { converters }),
    ).toThrow(/tool 'nameless_tool'.*has no description/s);
  });

  it('падает, когда вход не переводится в объектную схему', () => {
    expect(() =>
      buildToolDefinitions(routesOf(Primitive), { converters }),
    ).toThrow(/tool 'primitive_input'.*'input' is not an object form/s);
  });

  it('сообщает нарушения всех инструментов одним списком', () => {
    let message = '';

    try {
      buildToolDefinitions(routesOf(Nameless, Primitive), { converters });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(
      /2 problem\(s\) in tools declared on the MCP transport/,
    );
    expect(message).toMatch(/tool 'nameless_tool': it has no description/);
    expect(message).toMatch(
      /tool 'primitive_input': its 'input' is not an object form/,
    );
  });
});
