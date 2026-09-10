/**
 * Юниты HTTP-транспорта: заголовок в контексте, адрес клиента и строка
 * доступа.
 *
 * Проверки идут через пайплайн без сокета: юниты читают стартовый
 * контекст, а не `IncomingMessage`, поэтому запрос изображается значением.
 */

import type { HttpRequest } from './request.js';
import { httpAccessLog, withClientIp, withHeader } from './units.js';

import { describe, expect, it } from '@jest/globals';
import type {
  EndpointMeta,
  ExtendableContext,
  Fields,
  Logger,
  Raw,
  ResponseContext,
} from '@nestlingjs/app';
import { makeEmptyContext, makePipeline, Ok } from '@nestlingjs/app';

const http: HttpRequest = {
  method: 'GET',
  url: '/users?limit=10',
  headers: { 'x-tenant': 'acme', 'user-agent': 'jest' },
  ip: '10.0.0.7',
};

const raw: Raw = {
  transport: 'http',
  pattern: 'GET /users',
  payload: undefined,
  attributes: http.headers,
};

const endpoint: EndpointMeta = { transport: 'http', pattern: 'GET /users' };

/**
 * Контекст запроса со стартовым полем `http`, как его кладёт транспорт.
 *
 * Тип накопленного `input` здесь не важен: его доращивают сами юниты, а
 * тест подставляет контекст в `executeWithHandler` уже собранного
 * пайплайна.
 */
const contextOf = (request: HttpRequest = http): ExtendableContext<any> =>
  makeEmptyContext(raw, endpoint, undefined, {
    http: request,
  }) as ExtendableContext<any>;

/** Уровни логгера, которые тест не читает */
const ignore = (): void => undefined;

/** Логгер-шпион: записи копятся значениями */
function spyLogger(): { logger: Logger; entries: Fields[] } {
  const entries: Fields[] = [];
  const noop = ignore;
  const logger = {
    debug: noop,
    info: (_message: string, fields?: Fields) =>
      void entries.push(fields ?? {}),
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  } as unknown as Logger;

  return { logger, entries };
}

describe('withHeader — заголовок под своим именем', () => {
  it('кладёт значение в контекст под именем заголовка', async () => {
    const response = await makePipeline<{ http: HttpRequest }>()
      .pre(withHeader('x-tenant'))
      .executeWithHandler(
        (_payload, meta) => new Ok({ tenant: meta['x-tenant'] }),
        contextOf(),
      );

    expect(response).toMatchObject({
      isSuccess: true,
      value: { tenant: 'acme' },
    });
  });

  it('отсутствующий заголовок даёт undefined', async () => {
    const response = await makePipeline<{ http: HttpRequest }>()
      .pre(withHeader('x-missing'))
      .executeWithHandler(
        (_payload, meta) => new Ok({ value: meta['x-missing'] ?? null }),
        contextOf(),
      );

    expect(response).toMatchObject({ value: { value: null } });
  });
});

describe('withClientIp — адрес сокета', () => {
  it('кладёт адрес сокета в поле clientIp', async () => {
    const response = await makePipeline<{ http: HttpRequest }>()
      .pre(withClientIp())
      .executeWithHandler(
        (_payload, meta) => new Ok({ ip: meta.clientIp }),
        contextOf(),
      );

    expect(response).toMatchObject({ value: { ip: '10.0.0.7' } });
  });

  it('за прокси отдаёт адрес сокета, а не X-Forwarded-For', async () => {
    const proxied: HttpRequest = {
      ...http,
      headers: { ...http.headers, 'x-forwarded-for': '203.0.113.9' },
      ip: '10.0.0.1',
    };

    const response = await makePipeline<{ http: HttpRequest }>()
      .pre(withClientIp())
      .executeWithHandler(
        (_payload, meta) => new Ok({ ip: meta.clientIp }),
        contextOf(proxied),
      );

    expect(response).toMatchObject({ value: { ip: '10.0.0.1' } });
  });
});

describe('httpAccessLog — строка доступа', () => {
  it('несёт метод, путь, статус, исход и счётчики байтов', async () => {
    const { logger, entries } = spyLogger();
    const ctx = contextOf();
    ctx.summary.bytesIn = 12;
    ctx.summary.bytesOut = 34;

    const response: ResponseContext = await makePipeline<{
      http: HttpRequest;
    }>()
      .finally(httpAccessLog(logger))
      .executeWithHandler(() => new Ok('created', { id: '1' }), ctx);

    expect(response.isSuccess).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      method: 'GET',
      url: '/users?limit=10',
      status: 'created',
      outcome: 'completed',
      bytesIn: 12,
      bytesOut: 34,
    });
    expect(entries[0].duration).toBeUndefined();
  });
});
