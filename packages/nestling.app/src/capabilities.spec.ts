/**
 * Capability-валидация биндинга: форма операции против способностей
 * транспорта. Проверка обязана срабатывать **на сборке**, до приёма
 * запросов, и одинаково — через `App` (фаза ASSEMBLE) и в `serve`
 * (standalone-путь).
 */

import { assemble } from './app';
import { makeFeature } from './feature';
import { MockTransport } from './helpers';

import { describe, expect, it } from '@jest/globals';
import type { TransportRef } from '@nestling/pipeline';
import { events, multipart, Ok, stream, upload } from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';
import { makeDispatch, transportValue } from '@nestling/transport';
import {
  cliEndpoint,
  CliTransport,
  CliTransport$,
} from '@nestling/transport.cli';
import {
  httpEndpoint,
  HttpTransport,
  HttpTransport$,
} from '@nestling/transport.http';
import { z } from 'zod';

const Tick = z.object({ at: z.string() });

async function* noTicks(): AsyncIterableIterator<{ at: string }> {
  // намеренно пуст
}

/** Объявляет готовый инстанс транспорта экземпляром по умолчанию */
const asTransport = (token: TransportRef, transport: ITransport) =>
  transportValue(token, transport);

describe('capability-валидация через assemble', () => {
  it('events на CLI падает на сборке, называя команду, транспорт, слот и форму', async () => {
    const Watch = cliEndpoint({
      command: 'watch',
      output: events(Tick),
      handle: async () => new Ok(noTicks()),
    });

    const app = assemble({
      features: [makeFeature({ name: 'module:watch', endpoints: [Watch] })],
      transports: [
        asTransport(CliTransport$('default'), new CliTransport({ argv: [] })),
      ],
    });

    await expect(app.run()).rejects.toThrow(
      /Endpoint 'watch' declared in 'module:watch': transport 'cli' does not support form 'events' in 'output'/,
    );
  });

  it('multipart на транспорте без него падает и через assemble', async () => {
    const Upload = httpEndpoint({
      method: 'POST',
      path: '/upload',
      input: multipart({ files: { blob: upload() } }),
      handle: async () => new Ok({ ok: true }),
    });

    const app = assemble({
      features: [makeFeature({ name: 'module:upload', endpoints: [Upload] })],
      transports: [asTransport(HttpTransport$('default'), new MockTransport())],
    });

    await expect(app.run()).rejects.toThrow(
      /does not support form 'multipart' in 'input' \(supported: value\)/,
    );
  });

  it('поддерживаемая форма проходит сборку и старт приёма запросов', async () => {
    const Export = httpEndpoint({
      method: 'GET',
      path: '/export',
      output: stream(Tick),
      handle: async () => new Ok(noTicks()),
    });

    const app = assemble({
      features: [makeFeature({ name: 'module:export', endpoints: [Export] })],
      transports: [
        asTransport(
          HttpTransport$('default'),
          new HttpTransport({ port: 0, host: '127.0.0.1' }),
        ),
      ],
    });

    await app.run();
    await app.close();
  });

  it('транспорт не начинает принимать запросы при несовместимой декларации', async () => {
    const Live = httpEndpoint({
      method: 'GET',
      path: '/live',
      output: events(Tick),
      handle: async () => new Ok(noTicks()),
    });

    // Транспорт умеет только value-формы — как шина портов в V1
    const bus = new MockTransport();

    const app = assemble({
      features: [makeFeature({ name: 'module:live', endpoints: [Live] })],
      transports: [asTransport(HttpTransport$('default'), bus)],
    });

    await expect(app.run()).rejects.toThrow(/does not support form 'events'/);
    expect(bus.serving).toBe(false);
    expect(bus.routes).toHaveLength(0);
  });
});

describe('capability-валидация на standalone-пути', () => {
  it('multipart напрямую на CLI падает тем же текстом', async () => {
    const Upload = cliEndpoint({
      command: 'upload',
      input: multipart({ files: { blob: upload() } }) as never,
      handle: async () => new Ok({ ok: true }),
    });

    await expect(
      new CliTransport({ argv: [] }).serve(
        makeDispatch([Upload]),
        new AbortController().signal,
      ),
    ).rejects.toThrow(
      /Endpoint 'upload': transport 'cli' does not support form 'multipart' in 'input' \(supported: value, stream\)/,
    );
  });

  it('events напрямую на HTTP поднимается', async () => {
    const Live = httpEndpoint({
      method: 'GET',
      path: '/live',
      output: events(Tick),
      handle: async () => new Ok(noTicks()),
    });

    const transport = new HttpTransport({ port: 0, host: '127.0.0.1' });

    await expect(
      transport.serve(makeDispatch([Live]), new AbortController().signal),
    ).resolves.toBeUndefined();

    await transport.close();
  });
});
