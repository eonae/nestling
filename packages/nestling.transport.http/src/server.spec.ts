/**
 * Сервер как ресурс: секция на экземпляр, адрес после старта, цепочка
 * обработчиков и `404` от сервера.
 */

import { httpServerKeys } from './config.js';
import { HttpServer, httpServer, HttpServer$ } from './server.js';

import { describe, expect, it } from '@jest/globals';
import { bootstrapConfig, configKernel } from '@nestling/app';
import { ContainerBuilder } from '@nestling/container';

/** Строит контейнер с kernel-модулем конфига и объявленными серверами */
async function build(...declarations: ReturnType<typeof httpServer>[]) {
  const builder = new ContainerBuilder().register(
    configKernel(await bootstrapConfig([])),
  );

  for (const declaration of declarations) {
    builder.register(declaration.provider);
  }

  const container = builder.build();

  // Экземпляры создаёт INIT: до него сервера в графе нет
  await container.init();

  return container;
}

/** Выставляет одну переменную окружения или снимает её */
function applyEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
  } else {
    process.env[key] = value;
  }
}

/** Ставит переменные окружения на время одного теста */
function withEnv(vars: Record<string, string | undefined>): () => void {
  const previous = new Map(
    Object.keys(vars).map((key) => [key, process.env[key]]),
  );

  for (const [key, value] of Object.entries(vars)) {
    applyEnv(key, value);
  }

  return () => {
    for (const [key, value] of previous) {
      applyEnv(key, value);
    }
  };
}

/** Читает тело ответа как текст */
async function get(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`);

  return { status: response.status, body: await response.text() };
}

describe('httpServer() — секция на экземпляр', () => {
  it('экземпляр по умолчанию читает ключи пакета без добавки', () => {
    expect([...httpServerKeys().names]).toEqual(['HTTP_PORT', 'HTTP_HOST']);
  });

  it('именованный экземпляр читает свои ключи', () => {
    expect([...httpServerKeys('admin').names]).toEqual([
      'HTTP_ADMIN_PORT',
      'HTTP_ADMIN_HOST',
    ]);
  });

  it('повторное объявление одного имени даёт тот же токен', () => {
    expect(httpServer({ name: 'admin' }).token).toBe(
      httpServer({ name: 'admin' }).token,
    );
  });

  it('два экземпляра читают разные ключи', async () => {
    const restore = withEnv({ HTTP_PORT: '0', HTTP_ADMIN_PORT: 'abc' });

    try {
      // Валится только админский: значение своего ключа читает каждый сам
      await expect(
        build(httpServer(), httpServer({ name: 'admin' })),
      ).rejects.toThrow(/HTTP_ADMIN_PORT/);
    } finally {
      restore();
    }
  });

  it('невалидный порт валит сборку до захвата сокета', async () => {
    const restore = withEnv({ HTTP_PORT: 'abc' });

    try {
      await expect(build(httpServer())).rejects.toThrow(/HTTP_PORT/);
    } finally {
      restore();
    }
  });
});

describe('HttpServer — сокет и адрес', () => {
  it('после INIT сервер создан, но сокет не открыт', async () => {
    const restore = withEnv({ HTTP_PORT: '0', HTTP_HOST: '127.0.0.1' });

    try {
      const container = await build(httpServer());
      const server = container.getOrThrow(HttpServer$('default'));

      expect(server.address()).toBeNull();

      await server.release();
    } finally {
      restore();
    }
  });

  it('эфемерный порт: адрес известен после listen и пропадает после дренажа', async () => {
    const restore = withEnv({ HTTP_PORT: '0', HTTP_HOST: '127.0.0.1' });

    try {
      const container = await build(httpServer());
      const server = container.getOrThrow(HttpServer$('default'));

      await server.listen();

      const address = server.address();
      expect(address).not.toBeNull();
      expect(address?.port).toBeGreaterThan(0);

      await server.drain();
      expect(server.address()).toBeNull();

      // После дренажа освобождение ресурса ничего не делает
      await expect(server.release()).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });
});

describe('HttpServer — цепочка обработчиков', () => {
  it('запрос, который не взял никто, получает 404 от сервера', async () => {
    const server = new HttpServer({ port: 0, host: '127.0.0.1' });
    server.attach(async () => false);

    await server.listen();
    const baseUrl = `http://127.0.0.1:${server.address()?.port}`;

    try {
      const response = await get(baseUrl, '/nowhere');

      expect(response.status).toBe(404);
      expect(response.body).toBe('Not Found');
    } finally {
      await server.drain();
    }
  });

  it('обработчики вызываются в порядке присоединения', async () => {
    const server = new HttpServer({ port: 0, host: '127.0.0.1' });
    const calls: string[] = [];

    server.attach(async (request, response) => {
      calls.push('first');
      if (request.url !== '/first') {
        return false;
      }
      response.end('first');

      return true;
    });

    server.attach(async (request, response) => {
      calls.push('second');
      if (request.url !== '/second') {
        return false;
      }
      response.end('second');

      return true;
    });

    await server.listen();
    const baseUrl = `http://127.0.0.1:${server.address()?.port}`;

    try {
      expect(await get(baseUrl, '/second')).toEqual({
        status: 200,
        body: 'second',
      });
      expect(calls).toEqual(['first', 'second']);

      calls.length = 0;
      const direct = await get(baseUrl, '/first');
      expect(direct.body).toBe('first');
      expect(calls).toEqual(['first']);
    } finally {
      await server.drain();
    }
  });

  it('присоединение после старта — ошибка', async () => {
    const server = new HttpServer({ port: 0, host: '127.0.0.1' });

    await server.listen();

    try {
      expect(() => server.attach(async () => false)).toThrow(
        /already listening/,
      );
    } finally {
      await server.drain();
    }
  });
});
