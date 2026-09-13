/**
 * Типовые тесты HTTP-формы хендлера и шагов транспорта.
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import type { HttpStartContext } from './helpers.js';
import { httpEndpoint } from './helpers.js';
import type { HttpHandler, HttpHandlerMeta } from './request.js';
import type { HttpOutput } from './response.js';
import { HttpResponse } from './response.js';
import { withClientIp, withHeader } from './steps.js';

import type { Handler, HandlerMeta, Pipeline } from '@nestlingjs/app';
import { implement, makePipeline, Ok } from '@nestlingjs/app';
import { makeRequest } from '@nestlingjs/operations';
import { z } from 'zod';

const Login = makeRequest({
  name: 'handler-form.sessions.login',
  http: 'POST /login',
  input: z.object({ email: z.string() }),
  output: z.object({ token: z.string() }),
});

/** HTTP-класс: `meta` с запросом и результат с `HttpResponse` */
class LoginHttpHandler implements HttpHandler<typeof Login> {
  async handle(
    input: { email: string },
    meta: HttpHandlerMeta,
  ): HttpOutput<{ token: string }> {
    return HttpResponse.of(new Ok({ token: meta.http.headers.authorization }), {
      cookies: [{ name: 'sid', value: input.email, httpOnly: true }],
    });
  }
}

/** Нейтральный класс: `meta` без запроса и обычный результат */
class LoginHandler implements Handler<typeof Login> {
  async handle(input: { email: string }, meta: HandlerMeta) {
    return new Ok({ token: input.email });
  }
}

/** HTTP-класс не проходит в реализацию операции на шине */
const onBus = implement(Login, {
  // @ts-expect-error `meta.http` и `HttpResponse` — HTTP-форма хендлера
  handler: LoginHttpHandler,
});

/** HTTP-класс не проходит в реализацию операции */
const byOperation = httpEndpoint.implement(Login, {
  // @ts-expect-error та же причина: адрес принадлежит операции
  handler: LoginHttpHandler,
});

/** Нейтральный класс проходит в обе реализации */
const neutralOnBus = implement(Login, { handler: LoginHandler });
const neutralByOperation = httpEndpoint.implement(Login, {
  handler: LoginHandler,
});

/** Анонимная декларация принимает и HTTP-хендлер, и нейтральный */
const anonymous = httpEndpoint.post('/login', {
  input: z.object({ email: z.string() }),
  output: z.object({ token: z.string() }),
  handler: LoginHttpHandler,
});

const anonymousNeutral = httpEndpoint.post('/login-neutral', {
  input: z.object({ email: z.string() }),
  output: z.object({ token: z.string() }),
  handler: LoginHandler,
});

/** Декларация без пайплайна всё равно даёт хендлеру `meta.http` */
const readsHeader = httpEndpoint.get('/whoami', {
  output: z.object({ agent: z.string() }),
  handler: async (_payload, meta) =>
    new Ok({ agent: meta.http.headers['user-agent'] ?? 'unknown' }),
});

/** Пайплайн из шагов транспорта не растит `TNeeds` */
const httpBase = makePipeline<HttpStartContext>()
  .pre(withClientIp())
  .pre(withHeader('x-tenant'));

const executable: Pipeline<HttpStartContext, any, never> = httpBase;

/** Шаг транспорта читает стартовый контекст и виден хендлеру */
const withSteps = httpEndpoint.get('/tenant', {
  output: z.object({ tenant: z.string(), ip: z.string() }),
  pipeline: httpBase,
  handler: async (_payload, meta) =>
    new Ok({
      tenant: meta['x-tenant'] ?? 'none',
      ip: meta.clientIp ?? 'unknown',
    }),
});

/** Тот же пайплайн в `implement` не компилируется */
const stepsOnBus = implement(Login, {
  // @ts-expect-error { __error; missing: { http: HttpRequest }; hint }
  pipeline: httpBase,
  handler: LoginHandler,
});
