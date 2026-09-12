/**
 * Объявление инструмента: что берётся с операции и что добавляет словарь.
 *
 * Здесь проверяется только вывод. Нарушения — имя не по шаблону, описания
 * нет, имена столкнулись — сообщаются при сборке, и их проверяет
 * `definitions.spec.ts`.
 */

import { tool } from './tool.js';

import { describe, expect, it } from '@jest/globals';
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
});

const SendEmail = makeCommand({
  name: 'mcp-tool-spec.email.send',
  input: z.object({ to: z.string() }),
});

const UserRegistered = makeEvent({
  name: 'mcp-tool-spec.users.registered',
  input: z.object({ id: z.string() }),
});

describe('tool(operation, options?)', () => {
  it('возвращает значение и ничего не регистрирует', () => {
    const declared = tool(CreateUser);

    expect(declared.operation).toBe(CreateUser);
    expect(declared.name).toBe('mcp-tool-spec_users_create');
  });

  it('заменяет точки подчёркиваниями в выведенном имени', () => {
    expect(tool(FindUsers).name).toBe('mcp-tool-spec_users_find');
    expect(tool(FindUsers).nameDerived).toBe(true);
  });

  it('перекрывает выведенное имя явным', () => {
    const declared = tool(FindUsers, { name: 'search_users' });

    expect(declared.name).toBe('search_users');
    expect(declared.nameDerived).toBe(false);
  });

  it('берёт описание из doc.summary, когда описания нет в словаре', () => {
    expect(tool(CreateUser).description).toBe('Create a user');
  });

  it('предпочитает doc.description значению doc.summary', () => {
    expect(tool(FindUsers).description).toBe('The long one');
  });

  it('перекрывает описание операции значением словаря', () => {
    expect(tool(CreateUser, { description: 'Mine' }).description).toBe('Mine');
  });

  it('оставляет описание пустым, когда его нет ни в одном из трёх мест', () => {
    expect(tool(Silent).description).toBeUndefined();
  });

  it('переносит подсказки агенту как есть', () => {
    expect(tool(CreateUser, { annotations: { readOnlyHint: true } }))
      .toHaveProperty('annotations', { readOnlyHint: true });
  });

  it('отвергает операцию вида command', () => {
    expect(() => tool(SendEmail as never)).toThrow(
      /kind 'command'.*requires kind 'request'/s,
    );
  });

  it('отвергает операцию вида event', () => {
    expect(() => tool(UserRegistered as never)).toThrow(/kind 'event'/);
  });

  it('отвергает значение, которое не операция', () => {
    expect(() => tool({} as never)).toThrow(/created by makeRequest/);
  });

  it('отвергает неизвестное поле словаря, называя известные', () => {
    expect(() => tool(CreateUser, { title: 'Create' } as never)).toThrow(
      /unknown field 'title'.*name, description, annotations/s,
    );
  });
});
