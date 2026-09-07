/**
 * Транспорт как обычный провайдер: собственный сервер, присоединение к
 * общему и пропуск чужого маршрута.
 */

import { httpEndpoint } from './helpers.js';
import { HttpServer, httpServer, HttpServer$ } from './server.js';
import { HttpTransport$ } from './token.js';
import { http, HttpTransport } from './transport.js';

import { describe, expect, it } from '@jest/globals';
import type { ExecutableDeclaration } from '@nestling/app';
import {
  bootstrapConfig,
  configKernel,
  makeDispatch,
  makePipeline,
  Ok,
} from '@nestling/app';
import { ContainerBuilder } from '@nestling/container';

/** Строит контейнер с kernel-модулем конфига, транспортом и его сервером */
async function build(declaration: ReturnType<typeof http>) {
  const builder = new ContainerBuilder()
    .register(configKernel(await bootstrapConfig([])))
    .register(declaration.provider);

  if (declaration.server) {
    builder.register(declaration.server.provider);
  }

  const container = builder.build();

  // Экземпляры создаёт INIT: до него транспорта в графе нет
  await container.init();

  return container;
}

/** Endpoint-заглушка: отвечает своим именем на своём пути */
const ping = (path: string, body: string): ExecutableDeclaration =>
  httpEndpoint({
    method: 'GET',
    path,
    pipeline: makePipeline(),
    handler: () => new Ok({ body }),
  }) as unknown as ExecutableDeclaration;

describe('http() — объявление экземпляра', () => {
  it('без server объявляет собственный сервер с тем же именем', () => {
    const declaration = http({ name: 'admin' });

    expect(declaration.server?.name).toBe('admin');
    expect(declaration.server?.token).toBe(HttpServer$('admin'));
  });

  it('с server присоединяется к переданному объявлению', () => {
    const api = httpServer({ name: 'api' });

    expect(http({ server: api }).server).toBe(api);
  });

  it('транспорт получает сервер зависимостью', async () => {
    const container = await build(http());
    const transport = container.getOrThrow(HttpTransport$('default'));
    const server = container.getOrThrow(HttpServer$('default'));

    expect((transport as unknown as { server: HttpServer }).server).toBe(
      server,
    );

    await server.release();
  });
});

describe('HttpTransport — общий сервер', () => {
  it('два транспорта обслуживают свои маршруты на одном сокете', async () => {
    const server = new HttpServer({ port: 0, host: '127.0.0.1' });
    const first = new HttpTransport(server);
    const second = new HttpTransport(server);
    const { signal } = new AbortController();

    await first.serve(makeDispatch([ping('/first', 'first')]), signal);
    await second.serve(makeDispatch([ping('/second', 'second')]), signal);
    await server.listen();

    const baseUrl = `http://127.0.0.1:${server.address()?.port}`;

    try {
      // Маршрут второго транспорта обслужен: первый вернул «не мой»
      const second_ = await fetch(`${baseUrl}/second`);
      expect(second_.status).toBe(200);
      expect(await second_.json()).toEqual({ body: 'second' });

      const first_ = await fetch(`${baseUrl}/first`);
      expect(first_.status).toBe(200);
      expect(await first_.json()).toEqual({ body: 'first' });

      // Путь, которого нет ни у одного, — `404` от сервера
      const missing = await fetch(`${baseUrl}/nowhere`);
      expect(missing.status).toBe(404);
    } finally {
      await server.drain();
      await first.close();
      await second.close();
    }
  });

  it('транспорт не открывает сокет сам', async () => {
    const server = new HttpServer({ port: 0, host: '127.0.0.1' });
    const transport = new HttpTransport(server);

    await transport.serve(makeDispatch([]), new AbortController().signal);

    // `serve` присоединил обработчик, но адреса нет: сокет открывает
    // сервер, и делает это следующим шагом START
    expect(server.address()).toBeNull();
    expect(transport).not.toHaveProperty('address');

    await transport.close();
    await server.release();
  });
});
