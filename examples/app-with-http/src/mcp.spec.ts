/**
 * Инструменты агента: что приложение отдаёт по `tools/list`.
 *
 * Определения строятся из тех же деклараций, которые обслуживают запросы,
 * и сверяются здесь целиком. Правка описания или схемы видна в диффе этого
 * теста — там же, где её увидит агент.
 */

import { app } from './app.js';

import { describe, expect, it } from '@jest/globals';
import { buildToolDefinitions, McpTransport$ } from '@nestlingjs/mcp';
import { zodConverter } from '@nestlingjs/schema.zod';

/**
 * Определение инструмента по имени.
 *
 * По имени, а не по месту в списке: порядок объявления проверяет
 * отдельный тест, и остальным он не важен.
 */
const toolNamed = (name: string) => {
  const found = definitions().find((tool) => tool.name === name);

  if (!found) {
    throw new Error(`the application declares no tool named '${name}'`);
  }

  return found;
};

/**
 * Определения инструментов приложения в порядке объявления.
 *
 * Декларация подходит транспорту как есть: проекция маршрута — её
 * подмножество, и транспорт в `serve` получает то же самое.
 */
const definitions = () => {
  const found = app.discover().transports.get(McpTransport$('default')) ?? [];

  return buildToolDefinitions(
    found.map(({ endpoint }) => endpoint),
    { converters: [zodConverter()] },
  ).map((tool) => tool.definition);
};

describe('состав инструментов', () => {
  it('отдаёт агенту три инструмента', () => {
    expect(definitions().map((tool) => tool.name)).toEqual([
      'users_get',
      'users_create',
      'search_users',
    ]);
  });

  it('берёт имя и описание инструмента с операции', () => {
    expect(toolNamed('users_get')).toMatchObject({
      name: 'users_get',
      description: 'Пользователь по идентификатору',
      annotations: { readOnlyHint: true },
    });
  });

  it('описывает аргументы инструмента объектной схемой', () => {
    expect(toolNamed('users_get').inputSchema).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    });
  });

  it('объявляет схему выхода у инструмента с объектным ответом', () => {
    expect(toolNamed('users_create').outputSchema).toMatchObject({
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
      },
    });
  });

  it('несёт описание анонимного инструмента из его словаря', () => {
    const search = toolNamed('search_users');

    expect(search).toMatchObject({
      name: 'search_users',
      description:
        'Найти пользователей по подстроке в адресе почты. Возвращает ' +
        'число найденных и их карточки.',
      annotations: { readOnlyHint: true },
    });
    expect(search.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Подстрока адреса почты' },
      },
      required: ['query'],
    });
  });
});
