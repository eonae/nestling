/**
 * `contextValue` — request-контекст в тестовом корне.
 *
 * Предмет проверки — что подмена ридера действительно снимает потребность
 * в запросе: сервис читает переменную прямым вызовом, а подставленное
 * значение сильнее того, что кладёт пайплайн. Обратная сторона — тест,
 * ридер не подменивший, обязан видеть ровно боевую проекцию.
 */

import { SpyTransport } from './__fixtures__/transport';
import { assembleTest } from './app';
import { contextValue } from './context';
import { unwrap } from './unwrap';

import { describe, expect, it } from '@jest/globals';
import { makeApp, makeFeature } from '@nestling/app';
import { Injectable } from '@nestling/container';
import type { CtxReader } from '@nestling/pipeline';
import { Ctx, makePipeline, Ok, RequestId } from '@nestling/pipeline';
import { transportValue } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

const asHttpTransport = (transport: SpyTransport) =>
  transportValue(HttpTransport$('default'), transport);

/** Глубокий сервис: контекст читает ридером, параметром его не получает */
@Injectable([Ctx(RequestId)])
class AuditLog {
  constructor(private readonly requestId: CtxReader<string>) {}

  /** Как в бою: строгое чтение там, где переменная обязана быть */
  current(): string {
    return this.requestId.get();
  }

  /** Как в фоне: мягкое чтение там, где запроса может не быть */
  seen(): string | undefined {
    return this.requestId.peek();
  }
}

/** Endpoint, чей пайплайн кладёт **свой** requestId */
const Whoami = httpEndpoint({
  method: 'GET',
  path: '/whoami',
  output: z.object({ requestId: z.string() }),
  pipeline: makePipeline().pre(RequestId.provide(() => 'from-pipeline')),
  handler: {
    deps: [AuditLog],
    handle: (audit: AuditLog) => async () =>
      new Ok({ requestId: audit.current() }),
  },
});

const AuditModule = makeFeature({
  name: 'module:audit',
  providers: [AuditLog],
  endpoints: [Whoami],
});

describe('contextValue', () => {
  it('сервис читает подставленное значение без app.call', async () => {
    await using app = await assembleTest(
      makeApp({
        features: [AuditModule],
        transports: [asHttpTransport(new SpyTransport())],
      }),
      {
        overrides: [contextValue(RequestId, 'req-1')],
      },
    );

    const audit = app.get(AuditLog);

    // Ни запроса, ни открытого scope'а — только подменённый провайдер
    expect(audit?.current()).toBe('req-1');
    expect(audit?.seen()).toBe('req-1');
  });

  it('подмена приоритетна над значением, положенным пайплайном', async () => {
    await using app = await assembleTest(
      makeApp({
        features: [AuditModule],
        transports: [asHttpTransport(new SpyTransport())],
      }),
      {
        overrides: [contextValue(RequestId, 'req-1')],
      },
    );

    expect(unwrap(await app.call(Whoami))).toEqual({ requestId: 'req-1' });
  });

  it('без подмены app.call даёт боевое поведение проекции', async () => {
    await using app = await assembleTest(
      makeApp({
        features: [AuditModule],
        transports: [asHttpTransport(new SpyTransport())],
      }),
    );

    expect(unwrap(await app.call(Whoami))).toEqual({
      requestId: 'from-pipeline',
    });
    // Вне вызова scope'а нет: тот же сервис видит пустую проекцию
    expect(app.get(AuditLog)?.seen()).toBeUndefined();
  });
});
