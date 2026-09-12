/**
 * Объявление инструмента: что берётся с операции и что добавляет словарь.
 *
 * Здесь проверяется вывод имени, описания и биндинга. Нарушения, которые
 * видны только при старте — описания нет, схема не переводится, — проверяет
 * `definitions.spec.ts`.
 */

import { McpTransport$ } from './token.js';
import { mcpBindingOf, mcpTool } from './tool.js';

import { describe, expect, it } from '@jest/globals';
import { Ok } from '@nestlingjs/app';
import { makeCommand, makeEvent, makeRequest } from '@nestlingjs/operations';
import { z } from 'zod';

const CreateUser = makeRequest({
  name: 'mcp-tool-spec.users.create',
  input: z.object({ email: z.string() }),
  output: z.object({ id: z.string() }),
  doc: { summary: 'Create a user' },
});

const FindUsers = makeRequest({
  name: 'mcp-tool-spec.users.find',
  input: z.object({ query: z.string() }),
  output: z.object({ total: z.number() }),
  doc: { summary: 'Short one', description: 'The long one' },
});

const Silent = makeRequest({
  name: 'mcp-tool-spec.users.silent',
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

const SendEmail = makeCommand({
  name: 'mcp-tool-spec.email.send',
  input: z.object({ to: z.string() }),
});

const UserRegistered = makeEvent({
  name: 'mcp-tool-spec.users.registered',
  input: z.object({ id: z.string() }),
});

describe('mcpTool.implement(operation, { … })', () => {
  it('берёт схемы, отказы и секцию doc с операции', () => {
    const tool = mcpTool.implement(CreateUser, {
      handler: () => new Ok({ id: 'u-1' }),
    });

    expect(tool.input).toBe(CreateUser.input);
    expect(tool.output).toBe(CreateUser.output);
    expect(tool.doc).toBe(CreateUser.doc);
    expect(tool.transport).toBe(McpTransport$('default'));
  });

  it('заменяет точки подчёркиваниями в выведенном имени', () => {
    const tool = mcpTool.implement(CreateUser, {
      handler: () => new Ok({ id: 'u-1' }),
    });

    expect(tool.pattern).toBe('mcp-tool-spec_users_create');
  });

  it('перекрывает выведенное имя явным', () => {
    const tool = mcpTool.implement(FindUsers, {
      name: 'search_users',
      handler: () => new Ok({ total: 0 }),
    });

    expect(tool.pattern).toBe('search_users');
  });

  it('берёт описание из doc.description раньше, чем из doc.summary', () => {
    const tool = mcpTool.implement(FindUsers, {
      handler: () => new Ok({ total: 0 }),
    });

    expect(mcpBindingOf(tool).description).toBe('The long one');
  });

  it('берёт описание из doc.summary, когда description не объявлен', () => {
    const tool = mcpTool.implement(CreateUser, {
      handler: () => new Ok({ id: 'u-1' }),
    });

    expect(mcpBindingOf(tool).description).toBe('Create a user');
  });

  it('перекрывает описание операции описанием словаря', () => {
    const tool = mcpTool.implement(FindUsers, {
      description: 'Свой текст для агента',
      handler: () => new Ok({ total: 0 }),
    });

    expect(mcpBindingOf(tool).description).toBe('Свой текст для агента');
  });

  it('кладёт подсказки агенту в биндинг', () => {
    const tool = mcpTool.implement(FindUsers, {
      annotations: { readOnlyHint: true },
      handler: () => new Ok({ total: 0 }),
    });

    expect(mcpBindingOf(tool).annotations).toEqual({ readOnlyHint: true });
  });

  it('оставляет биндинг пустым, когда объявлять в него нечего', () => {
    const tool = mcpTool.implement(Silent, {
      handler: () => new Ok({ ok: true }),
    });

    expect(tool.binding).toBeUndefined();
    expect(mcpBindingOf(tool)).toEqual({});
  });

  it('выбирает экземпляр транспорта через on', () => {
    const tool = mcpTool.implement(Silent, {
      name: 'silent_admin',
      on: 'admin',
      handler: () => new Ok({ ok: true }),
    });

    expect(tool.transport).toBe(McpTransport$('admin'));
  });

  it('отвергает операцию вида command', () => {
    expect(() =>
      (mcpTool.implement as (o: unknown, d: unknown) => unknown)(SendEmail, {
        handler: () => new Ok(null),
      }),
    ).toThrow(/kind 'command'.*requires kind 'request'/s);
  });

  it('отвергает операцию вида event', () => {
    expect(() =>
      (mcpTool.implement as (o: unknown, d: unknown) => unknown)(
        UserRegistered,
        { handler: () => new Ok(null) },
      ),
    ).toThrow(/kind 'event'/);
  });

  it('отвергает первый аргумент, который не операция', () => {
    expect(() =>
      (mcpTool.implement as (o: unknown, d: unknown) => unknown)(
        { name: 'x' },
        { handler: () => new Ok(null) },
      ),
    ).toThrow(/must be an operation value created by makeRequest/);
  });

  it('отвергает поле операции в словаре реализации', () => {
    expect(() =>
      (mcpTool.implement as (o: unknown, d: unknown) => unknown)(CreateUser, {
        input: z.object({ other: z.string() }),
        handler: () => new Ok({ id: 'u-1' }),
      }),
    ).toThrow(/'input' belongs to the operation/);
  });

  it('отвергает имя не по шаблону протокола', () => {
    expect(() =>
      mcpTool.implement(CreateUser, {
        name: 'users/create',
        handler: () => new Ok({ id: 'u-1' }),
      }),
    ).toThrow(/does not match/);
  });
});

describe("mcpTool('<name>', { … })", () => {
  it('ставит имя инструмента паттерном декларации', () => {
    const tool = mcpTool('search_users', {
      description: 'Найти пользователей.',
      input: z.object({ query: z.string() }),
      output: z.object({ total: z.number() }),
      handler: () => new Ok({ total: 0 }),
    });

    expect(tool.pattern).toBe('search_users');
    expect(tool.transport).toBe(McpTransport$('default'));
    expect(mcpBindingOf(tool).description).toBe('Найти пользователей.');
  });

  it('отвергает имя не по шаблону протокола', () => {
    expect(() =>
      mcpTool('users/create', {
        description: 'Создать пользователя.',
        handler: () => new Ok(null),
      }),
    ).toThrow(String.raw`[a-zA-Z0-9_-]{1,128}`);
  });
});

describe('mcpBindingOf(bearer)', () => {
  it('читает пустой биндинг как пустые данные', () => {
    expect(mcpBindingOf({})).toEqual({});
    expect(mcpBindingOf({ binding: 'not an object' })).toEqual({});
  });
});
