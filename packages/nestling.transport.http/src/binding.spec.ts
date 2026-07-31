/**
 * Потребляющая половина bind-карты: чтение карты с декларации, разбор
 * query-строки и strict-сборка payload.
 *
 * Сам канон размещения (`computeHttpBinding` и его fail-fast) проверяется
 * там, где живёт правило, — `@nestling/contracts`.
 */

import type { BindPlacement } from './binding.js';
import {
  assemblePayload,
  computeHttpBinding,
  httpBindingOf,
  query,
  readQuery,
} from './binding.js';
import { HttpTransport$ } from './token.js';

import { describe, expect, it } from '@jest/globals';
import { Ok } from '@nestling/contracts';
import { makeEndpoint } from '@nestling/pipeline';
import { z } from 'zod';

const Input = z.object({
  id: z.string(),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

describe('httpBindingOf — фолбэк на канон', () => {
  it('kernel-декларация без карты считает тот же канон из pattern', () => {
    const Ping = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /ping',
      handle: async () => new Ok({ pong: true }),
    });

    expect(httpBindingOf(Ping)).toEqual({
      method: 'GET',
      path: '/ping',
      fields: {},
      rest: 'query',
      rawBody: false,
    });
  });

  it('фолбэк не бросает даже там, где конструктор отверг бы декларацию', () => {
    const Raw = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /users/:id',
      handle: async () => new Ok({}),
    });

    // Fail-fast — дело конструктора у владельца декларации; на горячем пути
    // транспорта его нет: канон определён парой (метод, путь)
    expect(httpBindingOf(Raw).fields).toEqual({ id: { in: 'path' } });
  });
});

const parse = (
  search: string,
  fields: Record<string, BindPlacement> = {},
): Record<string, unknown> => readQuery(new URLSearchParams(search), fields);

describe('readQuery — повторный ключ даёт массив', () => {
  it('одно вхождение — скаляр', () => {
    expect(parse('tag=a')).toEqual({ tag: 'a' });
  });

  it('два и более — массив в порядке следования', () => {
    expect(parse('tag=a&tag=b&tag=c')).toEqual({ tag: ['a', 'b', 'c'] });
  });

  it('multiple даёт массив и при одном вхождении', () => {
    expect(parse('tag=a', { tag: { in: 'query', multiple: true } })).toEqual({
      tag: ['a'],
    });
  });

  it('ноль вхождений — поля нет (отсутствие остаётся отсутствием)', () => {
    expect(parse('', { tag: { in: 'query', multiple: true } })).toEqual({});
  });
});

describe('assemblePayload — strict-приём', () => {
  it('приоритет: path > пометка > остальное', () => {
    const binding = computeHttpBinding({
      method: 'PATCH',
      path: '/users/:id',
      input: Input,
      bind: { name: query() },
    });

    const payload = assemblePayload(binding, {
      query: { name: 'from-query', extra: 'ignored' },
      body: { id: 'from-body', name: 'from-body', email: 'a@b.c' },
      params: { id: '42' },
    });

    expect(payload).toEqual({
      id: '42',
      name: 'from-query',
      email: 'a@b.c',
    });
  });

  it('поле не в своём месте в payload не попадает', () => {
    const binding = computeHttpBinding({
      method: 'POST',
      path: '/users',
      input: Input,
    });

    const payload = assemblePayload(binding, {
      query: { name: 'Alice' },
      body: undefined,
      params: {},
    });

    expect(payload).toEqual({});
  });

  it('помеченное поле, отсутствующее в своём месте, не подхватывается из тела', () => {
    const binding = computeHttpBinding({
      method: 'POST',
      path: '/users',
      input: Input,
      bind: { name: query() },
    });

    const payload = assemblePayload(binding, {
      query: {},
      body: { name: 'Alice', id: '1' },
      params: {},
    });

    expect(payload).toEqual({ id: '1' });
  });

  it('без явных размещений payload — источник «остальное» целиком', () => {
    const binding = computeHttpBinding({
      method: 'POST',
      path: '/batch',
      input: Input,
    });

    expect(
      assemblePayload(binding, {
        query: {},
        body: [{ id: '1' }],
        params: {},
      }),
    ).toEqual([{ id: '1' }]);
  });

  it('нечитанное тело даёт пустой объект, а не undefined', () => {
    const binding = computeHttpBinding({
      method: 'POST',
      path: '/users',
      input: Input,
    });

    // Схема отчитается о недостающих полях по именам, а не «expected object»
    expect(
      assemblePayload(binding, { query: {}, body: undefined, params: {} }),
    ).toEqual({});
  });
});
