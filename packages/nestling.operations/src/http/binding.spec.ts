/**
 * Правило размещения полей HTTP-input: три правила и проверки при
 * создании.
 *
 * Чтение карты (`readQuery`, `assemblePayload`, `httpBindingOf`)
 * проверяется в `@nestling/transport.http`.
 */

import { events, multipart, stream, upload } from '../io/index.js';

import { body, computeHttpBinding, query } from './binding.js';

import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

const Input = z.object({
  id: z.string(),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

describe('computeHttpBinding: правило размещения', () => {
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

describe('computeHttpBinding: проверки при создании', () => {
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

  it('multipart структурен: path-параметры и пометки допустимы', () => {
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
