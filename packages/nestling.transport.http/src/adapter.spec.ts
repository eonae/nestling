/**
 * Адаптер как объявление: сборка без сокета, общий DI-токен с `http()` и
 * отказы обработчика с названной причиной.
 *
 * Сам обмен запросами проверяет `adapter.integration.spec.ts`: здесь всё,
 * что видно до первого запроса.
 */

import {
  adapter,
  HttpAdapter,
  toFetchHandler,
  toNodeHandler,
} from './adapter.js';
import { serverKeys } from './config.js';
import { httpEndpoint } from './helpers.js';
import { HttpTransport$ } from './token.js';
import { http, HTTP_CAPABILITIES } from './transport.js';

import { describe, expect, it } from '@jest/globals';
import type { ConfigSource } from '@nestlingjs/app';
import { bind, makeApp, makeFeature, makePipeline, Ok } from '@nestlingjs/app';
import { z } from 'zod';

/** Endpoint-заглушка: одна и та же декларация обслуживается обеими формами */
const Ping = httpEndpoint.get('/ping', {
  output: z.object({ pong: z.boolean() }),
  pipeline: makePipeline(),
  handler: async () => new Ok({ pong: true }),
});

const Pings = makeFeature({ name: 'pings', endpoints: [Ping] });

/** Порт выбирает ОС, адрес — loopback: сокет теста никуда не смотрит */
const socketValues: Record<string, string> = {
  HTTP_PORT: '0',
  HTTP_HOST: '127.0.0.1',
};
const socket: ConfigSource = {
  name: 'test-socket',
  get: (key) => socketValues[key],
};

describe('adapter() — объявление экземпляра', () => {
  it('объявляет транспорт без сервера', () => {
    const declaration = adapter({ name: 'edge' });

    expect(declaration.server).toBeUndefined();
    expect(declaration.token).toBe(HttpTransport$('edge'));
  });

  it('объявляет то же значение способностей, что `http()`', () => {
    // Одна константа, а не копия литерала: копия разошлась бы с пакетом
    expect(adapter().capabilities).toBe(HTTP_CAPABILITIES);
    expect(http().capabilities).toBe(HTTP_CAPABILITIES);
  });

  it('сборка не открывает сокет и не заводит узла сервера', async () => {
    const app = makeApp({
      features: [Pings],
      transports: [adapter()],
    }).build();

    await app.run({ signals: false });

    expect(app.servers.size).toBe(0);
    expect(app.transports.get('default')).toBeInstanceOf(HttpAdapter);

    await app.close();
  });

  it('те же декларации собираются и с `http()`, и с адаптером', async () => {
    const withSocket = makeApp({
      features: [Pings],
      transports: [http()],
    }).build();

    const withAdapter = makeApp({
      features: [Pings],
      transports: [adapter()],
    }).build();

    await withSocket.run({
      signals: false,
      config: [bind(socket, { keys: serverKeys() })],
    });
    await withAdapter.run({ signals: false });

    // Обе сборки прошли BUILD на одной декларации, без правок в ней
    expect(withSocket.servers.size).toBe(1);
    expect(withAdapter.servers.size).toBe(0);

    await withSocket.close();
    await withAdapter.close();
  });

  it('адаптер рядом с сокетом под разными именами', async () => {
    const app = makeApp({
      features: [Pings],
      transports: [http(), adapter({ name: 'edge' })],
    }).build();

    await app.run({
      signals: false,
      config: [bind(socket, { keys: serverKeys() })],
    });

    expect(app.servers.size).toBe(1);
    expect(app.transports.get('edge')).toBeInstanceOf(HttpAdapter);

    await app.close();
  });

  it('адаптер рядом с сокетом под одним именем — занятый DI-токен', async () => {
    const app = makeApp({
      features: [Pings],
      transports: [http(), adapter()],
    }).build();

    // Отдельной проверки не нужно: DI-токен у обоих один
    await expect(
      app.run({
        signals: false,
        config: [bind(socket, { keys: serverKeys() })],
      }),
    ).rejects.toThrow(/transport:http:default/);

    await app.close();
  });
});

describe('обработчик существует только у запущенного приложения', () => {
  it('до `serve()` геттер называет `run()`', () => {
    const instance = new HttpAdapter();

    expect(() => instance.node).toThrow(/run\(\)/);
    expect(() => instance.fetch).toThrow(/run\(\)/);
  });

  it('до `run()` отказ называет `run()`', () => {
    const app = makeApp({
      features: [Pings],
      transports: [adapter()],
    }).build();

    expect(() => toFetchHandler(app)).toThrow(/run\(\)/);
  });

  it('имени, которого нет, отказ перечисляет имена сборки', async () => {
    const app = makeApp({
      features: [Pings],
      transports: [adapter()],
    }).build();

    await app.run({ signals: false });

    expect(() => toNodeHandler(app, { name: 'edge' })).toThrow(
      /No transport named 'edge'.*default/s,
    );

    await app.close();
  });

  it('транспорту с сокетом отказ называет `adapter()`', async () => {
    const app = makeApp({
      features: [Pings],
      transports: [http()],
    }).build();

    await app.run({
      signals: false,
      config: [bind(socket, { keys: serverKeys() })],
    });

    expect(() => toNodeHandler(app)).toThrow(/adapter\(/);

    await app.close();
  });
});
