/**
 * Capability-валидация биндинга: форма контракта против способностей
 * транспорта. Проверка обязана срабатывать **на сборке**, до приёма
 * запросов, и одинаково — через `App` и при прямой регистрации.
 */

import { App } from './app';
import { MockTransport } from './helpers';
import { makeAppModule } from './module';

import { describe, expect, it } from '@jest/globals';
import { events, multipart, Ok, stream, upload } from '@nestling/pipeline';
import { cliEndpoint, CliTransport } from '@nestling/transport.cli';
import { httpEndpoint, HttpTransport } from '@nestling/transport.http';
import { z } from 'zod';

const Tick = z.object({ at: z.string() });

async function* noTicks(): AsyncIterableIterator<{ at: string }> {
  // намеренно пуст
}

describe('capability-валидация через App', () => {
  it('events на CLI падает на старте, называя команду, транспорт, слот и форму', async () => {
    const Watch = cliEndpoint({
      command: 'watch',
      output: events(Tick),
      handle: async () => new Ok(noTicks()),
    });

    const app = new App({
      transports: { cli: new CliTransport() },
      modules: [makeAppModule({ name: 'module:watch', endpoints: [Watch] })],
    });

    await expect(app.run()).rejects.toThrow(
      /Endpoint 'watch' declared in module 'module:watch': transport 'cli' does not support form 'events' in 'output'/,
    );
  });

  it('multipart на транспорте без него падает и через App', async () => {
    const Upload = httpEndpoint({
      method: 'POST',
      path: '/upload',
      input: multipart({ files: { blob: upload() } }),
      handle: async () => new Ok({ ok: true }),
    });

    const app = new App({
      transports: { http: new MockTransport() as never },
      modules: [makeAppModule({ name: 'module:upload', endpoints: [Upload] })],
    });

    await expect(app.run()).rejects.toThrow(
      /does not support form 'multipart' in 'input' \(supported: value\)/,
    );
  });

  it('поддерживаемая форма регистрируется', async () => {
    const Export = httpEndpoint({
      method: 'GET',
      path: '/export',
      output: stream(Tick),
      handle: async () => new Ok(noTicks()),
    });

    const transport = new HttpTransport();
    const app = new App({
      transports: { http: transport },
      modules: [makeAppModule({ name: 'module:export', endpoints: [Export] })],
    });

    await app.run();
    await app.close();
  });

  it('сервер не начинает слушать при несовместимой декларации', async () => {
    const Live = httpEndpoint({
      method: 'GET',
      path: '/live',
      output: events(Tick),
      handle: async () => new Ok(noTicks()),
    });

    // Транспорт умеет только value-формы — как шина портов в V1
    const bus = new MockTransport();

    const app = new App({
      transports: { http: bus as never },
      modules: [makeAppModule({ name: 'module:live', endpoints: [Live] })],
    });

    await expect(app.run()).rejects.toThrow(/does not support form 'events'/);
    expect(bus.listening).toBe(false);
    expect(bus.endpoints).toHaveLength(0);
  });
});

describe('capability-валидация на standalone-пути', () => {
  it('multipart напрямую на CLI падает тем же текстом', () => {
    const Upload = cliEndpoint({
      command: 'upload',
      input: multipart({ files: { blob: upload() } }) as never,
      handle: async () => new Ok({ ok: true }),
    });

    expect(() => new CliTransport().endpoint(Upload)).toThrow(
      /Endpoint 'upload': transport 'cli' does not support form 'multipart' in 'input' \(supported: value, stream\)/,
    );
  });

  it('events напрямую на HTTP регистрируется', () => {
    const Live = httpEndpoint({
      method: 'GET',
      path: '/live',
      output: events(Tick),
      handle: async () => new Ok(noTicks()),
    });

    expect(() => new HttpTransport().route(Live)).not.toThrow();
  });
});
