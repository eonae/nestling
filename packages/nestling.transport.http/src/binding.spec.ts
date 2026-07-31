/**
 * Канон размещения HTTP-input: три правила, приоритет, fail-fast словаря и
 * разбор query-строки.
 */

import type { BindPlacement } from './binding';
import {
  assemblePayload,
  body,
  computeHttpBinding,
  httpBindingOf,
  query,
  readQuery,
} from './binding';
import { HttpTransport$ } from './token';

import { describe, expect, it } from '@jest/globals';
import {
  events,
  makeEndpoint,
  multipart,
  Ok,
  stream,
  upload,
} from '@nestling/pipeline';
import { z } from 'zod';

const Input = z.object({
  id: z.string(),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

describe('computeHttpBinding — канон размещения', () => {
  it('path-параметр шаблона выигрывает у правила по умолчанию', () => {
    const binding = computeHttpBinding({
      method: 'PATCH',
      path: '/users/:id',
      input: Input,
    });

    expect(binding.fields).toEqual({ id: { in: 'path' } });
    expect(binding.rest).toBe('body');
  });

  it('метод без тела кладёт остальное в query', () => {
    for (const method of ['GET', 'HEAD', 'DELETE', 'OPTIONS', 'TRACE']) {
      const binding = computeHttpBinding({
        method,
        path: '/users',
        input: Input,
      });

      expect(binding.rest).toBe('query');
    }
  });

  it('метод с телом кладёт остальное в body', () => {
    for (const method of ['POST', 'PUT', 'PATCH']) {
      const binding = computeHttpBinding({
        method,
        path: '/users',
        input: Input,
      });

      expect(binding.rest).toBe('body');
    }
  });

  it('пометка переносит поле в своё место', () => {
    const binding = computeHttpBinding({
      method: 'POST',
      path: '/users',
      input: Input,
      bind: { name: query(), tags: query({ multiple: true }) },
    });

    expect(binding.fields).toEqual({
      name: { in: 'query' },
      tags: { in: 'query', multiple: true },
    });
    expect(binding.rest).toBe('body');
  });

  it('карта иммутабельна', () => {
    const binding = computeHttpBinding({
      method: 'GET',
      path: '/users/:id',
      input: Input,
    });

    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.fields)).toBe(true);
  });

  it('метод нормализуется к верхнему регистру', () => {
    expect(computeHttpBinding({ method: 'get', path: '/ping' }).rest).toBe(
      'query',
    );
  });
});

describe('computeHttpBinding — fail-fast словаря', () => {
  it('пометка на поле-path-параметре', () => {
    expect(() =>
      computeHttpBinding({
        method: 'PATCH',
        path: '/users/:id',
        input: Input,
        bind: { id: query() },
      }),
    ).toThrow(/field 'id' is the path parameter ':id'/);
  });

  it('body() у метода без тела', () => {
    expect(() =>
      computeHttpBinding({
        method: 'GET',
        path: '/users',
        input: Input,
        bind: { name: body() },
      }),
    ).toThrow(/'name' is bound to the body, but 'GET' has no request body/);
  });

  it('непустой bind при неструктурном input', () => {
    expect(() =>
      computeHttpBinding({
        method: 'POST',
        path: '/logs',
        input: stream(Input),
        bind: { name: query() },
      }),
    ).toThrow(/'bind' is not applicable to a non-structural input/);

    expect(() =>
      computeHttpBinding({
        method: 'GET',
        path: '/live',
        input: events(Input),
        bind: { name: query() },
      }),
    ).toThrow(/'bind' is not applicable to a non-structural input/);

    expect(() =>
      computeHttpBinding({
        method: 'POST',
        path: '/text',
        input: 'text',
        bind: { name: query() },
      }),
    ).toThrow(/'bind' is not applicable to a non-structural input/);
  });

  it('path-параметр при неструктурном input', () => {
    expect(() =>
      computeHttpBinding({
        method: 'POST',
        path: '/users/:id/logs',
        input: stream(Input),
      }),
    ).toThrow(/path parameter ':id' has nowhere to go/);
  });

  it('path-параметр при отсутствии input', () => {
    expect(() =>
      computeHttpBinding({ method: 'GET', path: '/users/:id' }),
    ).toThrow(
      /path parameter ':id' has nowhere to go — the declaration has no/,
    );
  });

  it('rawBody вместе со stream / events / multipart', () => {
    expect(() =>
      computeHttpBinding({
        method: 'POST',
        path: '/hooks',
        input: stream(Input),
        rawBody: true,
      }),
    ).toThrow(/'rawBody: true' is not compatible/);

    expect(() =>
      computeHttpBinding({
        method: 'GET',
        path: '/hooks',
        input: events(Input),
        rawBody: true,
      }),
    ).toThrow(/'rawBody: true' is not compatible/);

    expect(() =>
      computeHttpBinding({
        method: 'POST',
        path: '/hooks',
        input: multipart({ files: { blob: upload() } }),
        rawBody: true,
      }),
    ).toThrow(/'rawBody: true' is not compatible/);
  });

  it('строковая форма записи места не принимается', () => {
    expect(() =>
      computeHttpBinding({
        method: 'POST',
        path: '/users',
        input: Input,
        bind: { name: 'query' } as never,
      }),
    ).toThrow(/must be a mark created by query\(\) or body\(\)/);
  });

  it('multipart структурен: path-параметры и пометки легальны', () => {
    const binding = computeHttpBinding({
      method: 'POST',
      path: '/users/:id/avatar',
      input: multipart({ fields: Input, files: { avatar: upload() } }),
      bind: { name: query() },
    });

    expect(binding.fields).toEqual({
      id: { in: 'path' },
      name: { in: 'query' },
    });
  });
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
