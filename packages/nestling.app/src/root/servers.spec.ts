/**
 * Серверы в корне: регистрация вложенного объявления, порядок START и
 * SHUTDOWN, доступ к объявленным серверам.
 */

import { transportValue } from '../transport/index.js';

import {
  MarkingTransport,
  TestListener,
  testServer,
  testTransport,
} from './__fixtures__/test-server.js';
import { TestTransport$, VALUE_ONLY } from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';

import { describe, expect, it } from '@jest/globals';
import { Resource } from '@nestlingjs/container';

describe('serverы в `transports:` — регистрация', () => {
  it('транспорт заводит свой сервер: два узла на одно объявление', async () => {
    const marks: string[] = [];
    const server = testServer({ marks });

    const app = makeApp({
      transports: [testTransport({ server, marks })],
    }).assemble();

    await app.run();

    expect(app.servers.get('default')).toBeInstanceOf(TestListener);
    expect(marks).toEqual([
      'acquire:default',
      'serve:default',
      'listen:default',
    ]);

    await app.close();
  });

  it('сервер, названный дважды, регистрируется один раз', async () => {
    const marks: string[] = [];
    const server = testServer({ marks });

    const app = makeApp({
      transports: [server, testTransport({ server, marks })],
    }).assemble();

    await app.run();

    expect(marks.filter((mark) => mark === 'acquire:default')).toHaveLength(1);
    expect(app.servers.size).toBe(1);

    await app.close();
  });

  it('два разных объявления с одним именем — ошибка сборки', () => {
    const marks: string[] = [];

    expect(() =>
      makeApp({
        transports: [testServer({ marks }), testServer({ marks })],
      }),
    ).toThrow(/Two different server declarations are named 'default'/);
  });
});

describe('START — сокет открывается последним', () => {
  it('порядок наблюдаем: acquire → @OnStart → serve → listen', async () => {
    const marks: string[] = [];
    const server = testServer({ marks });

    @Resource([])
    class Pool {
      static async acquire(): Promise<Pool> {
        marks.push('acquire:pool');

        return new Pool();
      }

      async release(): Promise<void> {
        marks.push('release:pool');
      }
    }

    const app = makeApp({
      endpoints: [],
      providers: [Pool],
      transports: [testTransport({ server, marks })],
    }).assemble();

    await app.run();

    expect(marks).toEqual([
      'acquire:pool',
      'acquire:default',
      'serve:default',
      'listen:default',
    ]);

    await app.close();
  });

  it('listen идёт после `serve` всех транспортов общего сервера', async () => {
    const marks: string[] = [];
    const server = testServer({ name: 'api', marks });

    const app = makeApp({
      transports: [
        server,
        testTransport({ name: 'first', server, marks }),
        testTransport({ name: 'second', server, marks }),
      ],
    }).assemble();

    await app.run();

    expect(marks).toEqual([
      'acquire:api',
      'serve:first',
      'serve:second',
      'listen:api',
    ]);

    await app.close();
  });

  it('сокета нет до START: после INIT сервер создан, но не слушает', async () => {
    const marks: string[] = [];
    const server = testServer({ marks });

    const app = makeApp({
      transports: [testTransport({ server, marks })],
    }).assemble();

    // Прогон до RUN не остановить снаружи, поэтому наблюдаем то же по
    // журналу: `listen` идёт после `serve`, а не при захвате ресурса
    await app.run();

    expect(marks.indexOf('acquire:default')).toBeLessThan(
      marks.indexOf('serve:default'),
    );
    expect(marks.indexOf('serve:default')).toBeLessThan(
      marks.indexOf('listen:default'),
    );

    await app.close();
  });
});

describe('SHUTDOWN — строгий реверс', () => {
  it('дренаж серверов идёт до `close` транспортов и до `release` ресурсов', async () => {
    const marks: string[] = [];
    const first = testServer({ name: 'first', marks });
    const second = testServer({ name: 'second', marks });

    @Resource([])
    class Pool {
      static async acquire(): Promise<Pool> {
        marks.push('acquire:pool');

        return new Pool();
      }

      async release(): Promise<void> {
        marks.push('release:pool');
      }
    }

    const app = makeApp({
      endpoints: [],
      providers: [Pool],
      transports: [
        testTransport({ name: 'first', server: first, marks }),
        testTransport({ name: 'second', server: second, marks }),
      ],
    }).assemble();

    await app.run();
    marks.length = 0;

    await app.close();

    // Дренаж — до `close`, `close` — до `release`. Порядок самих
    // `release` задаёт контейнер: это реверс топологического порядка
    expect(marks.slice(0, 4)).toEqual([
      'drain:second',
      'drain:first',
      'close:second',
      'close:first',
    ]);
    expect(marks.slice(4).sort()).toEqual([
      'release:first',
      'release:pool',
      'release:second',
    ]);
  });

  it('после остановки список серверов пуст', async () => {
    const marks: string[] = [];
    const server = testServer({ marks });

    const app = makeApp({
      transports: [testTransport({ server, marks })],
    }).assemble();

    await app.run();
    const listener = app.servers.get('default');
    expect(listener).toBeInstanceOf(TestListener);

    await app.close();

    expect(app.servers.size).toBe(0);
    expect((listener as TestListener).listening).toBe(false);
  });
});

describe('транспорт без сервера', () => {
  it('объявление без поля `server` не заводит узла слушателя', async () => {
    const marks: string[] = [];

    // Транспорт без сокета (`cli()`, шина) поля `server` не имеет вовсе
    const app = makeApp({
      transports: [
        transportValue(
          TestTransport$('default'),
          new MarkingTransport('default', marks),
          { capabilities: VALUE_ONLY },
        ),
      ],
    }).assemble();

    await app.run();

    expect(app.servers.size).toBe(0);
    expect(marks).toEqual(['serve:default']);

    await app.close();
  });
});
