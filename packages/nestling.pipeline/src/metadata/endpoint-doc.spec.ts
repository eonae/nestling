/**
 * Слот `doc:` в декларации: перенос на значение, выживание при `resolve` и
 * fail-fast словаря.
 *
 * Проверяется там же, где `errors:` и `detached`, — в момент создания
 * значения: дефектная документация это дефект декларации, а не сборки.
 */

import { Ok } from '../core';

import { makeEndpoint } from './endpoint';

import { describe, expect, it } from '@jest/globals';
import { makeToken } from '@nestling/container';

const HttpTransport$ = makeToken('transport:http');

interface IClock {
  now(): number;
}

const IClock$ = makeToken<IClock>('IClock');

describe('doc — секция на значении декларации', () => {
  it('переносится на декларацию как есть', () => {
    const List = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /users',
      doc: { summary: 'List users', tags: ['users'] },
      handler: async () => new Ok([]),
    });

    expect(List.doc).toEqual({ summary: 'List users', tags: ['users'] });
  });

  it('переживает резолв зависимостей', () => {
    const List = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /users',
      doc: { summary: 'List users', status: 'ok' },
      handler: {
        deps: [IClock$],
        handle: (clock: IClock) => async () => new Ok({ at: clock.now() }),
      },
    });

    const resolved = List.resolve(() => ({ now: () => 0 }));

    expect(resolved.doc).toEqual({ summary: 'List users', status: 'ok' });
  });

  it('декларация без секции поля не несёт', () => {
    const List = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /users',
      handler: async () => new Ok([]),
    });

    expect('doc' in List).toBe(false);
  });

  it('исполнение запроса от секции не зависит', async () => {
    const meta = {
      signal: new AbortController().signal,
      fail: (error: never): never => {
        throw error;
      },
    };

    const documented = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /users',
      doc: { summary: 'List users', deprecated: true },
      handler: async () => new Ok({ ok: true }),
    });

    await expect(documented.handle({}, meta)).resolves.toMatchObject({
      value: { ok: true },
    });
  });
});

/** Объявление endpoint'а с произвольным `doc` — как это сделал бы JS */
const declare = (doc: unknown) => () =>
  (makeEndpoint as (options: unknown) => unknown)({
    transport: HttpTransport$,
    pattern: 'GET /users',
    doc,
    handler: async () => new Ok([]),
  });

describe('doc — fail-fast словаря', () => {
  it('секция не объектом отвергается', () => {
    expect(declare('List users')).toThrow(TypeError);
    expect(declare(['users'])).toThrow(/'doc' must be a section object/);
  });

  it('не-строка в summary/description отвергается с именем поля', () => {
    expect(declare({ summary: 42 })).toThrow(/'doc.summary' must be a string/);
    expect(declare({ description: {} })).toThrow(
      /'doc.description' must be a string/,
    );
  });

  it('tags не массивом непустых строк отвергается', () => {
    expect(declare({ tags: 'users' })).toThrow(/'doc.tags' must be an array/);
    expect(declare({ tags: ['users', 7] })).toThrow(/'doc.tags' must be/);
    expect(declare({ tags: [''] })).toThrow(/non-empty strings/);
  });

  it('deprecated не булевым отвергается', () => {
    expect(declare({ deprecated: 'yes' })).toThrow(
      /'doc.deprecated' must be a boolean/,
    );
  });

  it('статус вне словаря успешных перечисляет допустимые', () => {
    expect(declare({ status: 'PARTIAL_CONTENT' })).toThrow(
      /'doc.status' must be one of 'ok', 'created', 'accepted', 'no_content'/,
    );
    // Отказный статус тоже вне словаря: слот описывает успех
    expect(declare({ status: 'conflict' })).toThrow(/'doc.status' must be/);
  });

  it('hidden без причины отвергается, и текст называет требование', () => {
    expect(declare({ hidden: '' })).toThrow(/must state a reason/);
    expect(declare({ hidden: '   ' })).toThrow(/must state a reason/);
    expect(declare({ hidden: true })).toThrow(TypeError);
    expect(declare({ hidden: true })).toThrow(/There is no 'hidden: true'/);
  });

  it('неизвестное поле секции отвергается, и текст объясняет operationId', () => {
    expect(declare({ operationId: 'listUsers' })).toThrow(
      /'doc.operationId' is not a field of the documentation section/,
    );
    expect(declare({ operationId: 'listUsers' })).toThrow(
      /derived from the operation name/,
    );
  });

  it('текст ошибки называет endpoint', () => {
    expect(declare({ hidden: '' })).toThrow(/Endpoint 'GET \/users'/);
  });
});

describe('doc — типы', () => {
  it('hidden: true невыразим по типам и отвергается рантаймом', () => {
    expect(() =>
      makeEndpoint({
        transport: HttpTransport$,
        pattern: 'GET /users',
        // @ts-expect-error: причина обязана быть строкой — `true` не форма opt-out'а
        doc: { hidden: true },
        handler: async () => new Ok([]),
      }),
    ).toThrow(TypeError);
  });

  it('неизвестное поле невыразимо по типам', () => {
    expect(() =>
      makeEndpoint({
        transport: HttpTransport$,
        pattern: 'GET /users',
        // @ts-expect-error: имя операции выводится, а не объявляется
        doc: { operationId: 'listUsers' },
        handler: async () => new Ok([]),
      }),
    ).toThrow(TypeError);
  });
});
