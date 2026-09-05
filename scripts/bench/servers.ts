/**
 * Серверы бенчмарка: одна пара endpoint'ов на четырёх фреймворках.
 *
 * `GET /users/:id` отвечает JSON, `POST /users` проверяет тело одной и той
 * же zod-схемой у всех. Nestling проверяет схемой и path-параметр:
 * декларация с path-параметром без `input` запрещена. Остальные читают
 * параметр как есть.
 *
 * Пакеты Nestling берутся из `dist`, поэтому перед запуском нужна сборка.
 * Каждый сервер поднимает `bench/server.ts` в отдельном процессе.
 */

import type { Server } from 'node:http';

import { serve as serveHono } from '@hono/node-server';
import express from 'express';
import Fastify from 'fastify';
import { Hono } from 'hono';
import { z } from 'zod';

import { Ok } from '@nestling/pipeline';
import { makeDispatch } from '@nestling/transport';
import { httpEndpoint, HttpTransport } from '@nestling/transport.http';

const HOST = '127.0.0.1';

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

const nestling: ServerStarter = async () => {
  const GetUser = httpEndpoint({
    method: 'GET',
    path: '/users/:id',
    input: z.object({ id: z.string() }),
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

  const transport = new HttpTransport({ port: 0, host: HOST });
  await transport.serve(
    makeDispatch([GetUser, CreateUser]),
    new AbortController().signal,
  );

  const address = transport.address();
  if (!address) {
    throw new Error('HttpTransport did not report an address after serve()');
  }

  return { port: address.port, stop: () => transport.close() };
};

const fastify: ServerStarter = async () => {
  const app = Fastify({ logger: false });

  app.get<{ Params: { id: string } }>('/users/:id', (request) =>
    userOf(request.params.id),
  );

  app.post('/users', (request) => createdOf(NewUser.parse(request.body)));

  await app.listen({ port: 0, host: HOST });

  return { port: portOf(app.server), stop: () => app.close() };
};

const expressServer: ServerStarter = async () => {
  const app = express();
  app.use(express.json());

  app.get('/users/:id', (request, response) => {
    response.json(userOf(request.params.id));
  });

  app.post('/users', (request, response) => {
    response.json(createdOf(NewUser.parse(request.body)));
  });

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, HOST, () => resolve(listening));
  });

  return { port: portOf(server), stop: closeServer(server) };
};

const hono: ServerStarter = async () => {
  const app = new Hono();

  app.get('/users/:id', (context) => context.json(userOf(context.req.param('id'))));

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
  fastify,
  express: expressServer,
  hono,
};
