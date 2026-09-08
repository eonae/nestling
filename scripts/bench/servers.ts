/**
 * Серверы бенчмарка: одна пара endpoint'ов на четырёх фреймворках.
 *
 * `GET /users/:id` отвечает JSON, `POST /users` проверяет тело одной и той
 * же zod-схемой у всех. Каждый чужой фреймворк представлен двумя
 * вариантами.
 *
 * - Вариант с теми же обязанностями, что у Nestling (`fastify`, `hono`,
 *   `express`): path-параметр проверяется той же zod-схемой, а на каждый
 *   запрос открывается область `AsyncLocalStorage`. Это то, что endpoint
 *   Nestling делает всегда: проверку входа и область контекста отключить
 *   нельзя.
 * - Голый вариант (`fastify-bare`, `hono-bare`, `express-bare`): маршрут и
 *   ответ, параметр читается как есть. Это нижняя граница цены самого
 *   фреймворка.
 * - Вариант со слоями (`nestling-layers`, `fastify-layers`): поверх
 *   обязанностей выше идентификатор запроса из заголовка или `randomUUID`,
 *   арендатор из заголовка `x-tenant` и счётчик исходов после ответа. У
 *   Nestling это слой из двух pre-юнитов и `.finally`, у Fastify — хуки
 *   `onRequest` и `onResponse`. Это цена слоёв.
 *
 * Пакеты Nestling берутся из `dist`, поэтому перед запуском нужна сборка.
 * Каждый сервер поднимает `bench/server.ts` в отдельном процессе.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { serve as serveHono } from '@hono/node-server';
import express from 'express';
import Fastify from 'fastify';
import { Hono } from 'hono';
import { z } from 'zod';

import { makePipeline, Ok, withRequestId } from '@nestling/app';
import { makeDispatch } from '@nestling/app';
import type { ExecutableDeclaration } from '@nestling/app';
import {
  httpEndpoint,
  HttpServer,
  HttpTransport,
} from '@nestling/transport.http';

const HOST = '127.0.0.1';

const IdParam = z.object({ id: z.string() });
const NewUser = z.object({ name: z.string(), email: z.string() });
const User = z.object({ id: z.string(), name: z.string() });

/** Ответ на `GET`: одинаковое значение и одинаковый JSON у всех серверов */
const userOf = (id: string): { id: string; name: string } => ({
  id,
  name: `user-${id}`,
});

/** Ответ на `POST` */
const createdOf = (body: { name: string }): { id: string; name: string } => ({
  id: 'u-1',
  name: body.name,
});

/**
 * Область запроса у вариантов с теми же обязанностями. Значение — один
 * объект на запрос, как ячейка контекста у Nestling.
 */
const requestScope = new AsyncLocalStorage<{ path: string }>();

/** Запущенный сервер: порт и остановка */
export interface RunningServer {
  port: number;
  stop: () => Promise<void>;
}

/** Фабрика сервера: поднимает его на эфемерном порту */
export type ServerStarter = () => Promise<RunningServer>;

/** Порт `node:http`-сервера после `listen` */
function portOf(server: { address(): unknown }): number {
  const address = server.address();
  if (!address || typeof address !== 'object' || !('port' in address)) {
    throw new Error('server did not report a port after listen()');
  }

  return (address as { port: number }).port;
}

/** Останавливает `node:http`-сервер и ждёт закрытия */
const closeServer = (server: Server) => (): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

/**
 * Поднимает HTTP-транспорт Nestling на эфемерном порту.
 *
 * Сокет транспорту не принадлежит: его держит `HttpServer`, поэтому порт
 * задаётся серверу, а транспорт присоединяет к нему обработчик в `serve`.
 */
async function startNestling(
  endpoints: readonly ExecutableDeclaration[],
): Promise<RunningServer> {
  const server = new HttpServer({ port: 0, host: HOST });
  const transport = new HttpTransport(server);

  await transport.serve(
    makeDispatch([...endpoints]),
    new AbortController().signal,
  );
  await server.listen();

  const address = server.address();
  if (!address) {
    throw new Error('HttpServer did not report an address after listen()');
  }

  return {
    port: address.port,
    stop: async () => {
      await server.drain();
      await transport.close();
    },
  };
}

const nestling: ServerStarter = async () => {
  const GetUser = httpEndpoint({
    method: 'GET',
    path: '/users/:id',
    input: IdParam,
    output: User,
    handler: ({ id }) => new Ok(userOf(id)),
  });

  const CreateUser = httpEndpoint({
    method: 'POST',
    path: '/users',
    input: NewUser,
    output: User,
    handler: (body) => new Ok(createdOf(body)),
  });

  return startNestling([GetUser, CreateUser]);
};

/** Счётчик исходов: `.finally` и `onResponse` пишут сюда */
const outcomes = new Map<string, number>();
const countOutcome = (outcome: string): void => {
  outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
};

/** Nestling со слоем: идентификатор запроса, арендатор, `.finally` */
const nestlingLayers: ServerStarter = async () => {
  const layered = makePipeline()
    .pre(withRequestId())
    .pre((ctx) => ({
      tenant: String(ctx.raw.attributes['x-tenant'] ?? 'default'),
    }))
    .finally((outcome) => countOutcome(outcome));

  const GetUser = httpEndpoint({
    method: 'GET',
    path: '/users/:id',
    input: IdParam,
    output: User,
    pipeline: layered,
    handler: ({ id }) => new Ok(userOf(id)),
  });

  const CreateUser = httpEndpoint({
    method: 'POST',
    path: '/users',
    input: NewUser,
    output: User,
    pipeline: layered,
    handler: (body) => new Ok(createdOf(body)),
  });

  return startNestling([GetUser, CreateUser]);
};

/** Fastify; `sameDuties` добавляет проверку параметра и область запроса */
const fastify =
  (sameDuties: boolean, layers = false): ServerStarter =>
  async () => {
    const app = Fastify({ logger: false });

    if (sameDuties) {
      // Хук `onRequest` открывает область на остаток обработки: `done`
      // вызывается внутри `run`, и хендлер видит хранилище
      app.addHook('onRequest', (request, _reply, done) => {
        requestScope.run({ path: request.url }, done);
      });
    }

    if (layers) {
      app.addHook('onRequest', (request, _reply, done) => {
        const store = requestScope.getStore() as Record<string, unknown>;
        store.requestId = request.headers['x-request-id'] ?? randomUUID();
        store.tenant = String(request.headers['x-tenant'] ?? 'default');
        done();
      });
      app.addHook('onResponse', (_request, reply, done) => {
        countOutcome(reply.statusCode < 400 ? 'completed' : 'failed');
        done();
      });
    }

    if (sameDuties) {
      app.get('/users/:id', (request) =>
        userOf(IdParam.parse(request.params).id),
      );
    } else {
      app.get<{ Params: { id: string } }>('/users/:id', (request) =>
        userOf(request.params.id),
      );
    }

    app.post('/users', (request) => createdOf(NewUser.parse(request.body)));

    await app.listen({ port: 0, host: HOST });

    return { port: portOf(app.server), stop: () => app.close() };
  };

/** Express; `sameDuties` добавляет проверку параметра и область запроса */
const expressServer =
  (sameDuties: boolean): ServerStarter =>
  async () => {
    const app = express();
    app.use(express.json());

    if (sameDuties) {
      app.use((request, _response, next) => {
        requestScope.run({ path: request.path }, next);
      });

      app.get('/users/:id', (request, response) => {
        response.json(userOf(IdParam.parse(request.params).id));
      });
    } else {
      app.get('/users/:id', (request, response) => {
        response.json(userOf(request.params.id));
      });
    }

    app.post('/users', (request, response) => {
      response.json(createdOf(NewUser.parse(request.body)));
    });

    const server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, HOST, () => resolve(listening));
    });

    return { port: portOf(server), stop: closeServer(server) };
  };

/** Hono; `sameDuties` добавляет проверку параметра и область запроса */
const hono =
  (sameDuties: boolean): ServerStarter =>
  async () => {
    const app = new Hono();

    if (sameDuties) {
      app.use((context, next) =>
        requestScope.run({ path: context.req.path }, next),
      );

      app.get('/users/:id', (context) =>
        context.json(userOf(IdParam.parse(context.req.param()).id)),
      );
    } else {
      app.get('/users/:id', (context) =>
        context.json(userOf(context.req.param('id'))),
      );
    }

    app.post('/users', async (context) =>
      context.json(createdOf(NewUser.parse(await context.req.json()))),
    );

    const server = await new Promise<Server>((resolve) => {
      const listening = serveHono(
        { fetch: app.fetch, hostname: HOST, port: 0 },
        () => resolve(listening as Server),
      );
    });

    return { port: portOf(server), stop: closeServer(server) };
  };

/** Серверы по имени; порядок — порядок в отчёте */
export const SERVERS: Readonly<Record<string, ServerStarter>> = {
  nestling,
  fastify: fastify(true),
  hono: hono(true),
  express: expressServer(true),
  'fastify-bare': fastify(false),
  'hono-bare': hono(false),
  'express-bare': expressServer(false),
  'nestling-layers': nestlingLayers,
  'fastify-layers': fastify(true, true),
};
