/**
 * Capability-валидация биндинга: форма декларации против способностей
 * транспорта. Проверка обязана срабатывать **на сборке**, до приёма
 * запросов.
 *
 * Транспорт здесь фейковый: предмет проверки — фаза ASSEMBLE, а не работа
 * конкретного транспорта. Ту же проверку на своём `serve` каждый транспорт
 * проверяет собственными спеками.
 */

import type { ITransport } from '../transport/index.js';
import { transportValue } from '../transport/index.js';

import {
  ALL_FORMS,
  testEndpoint,
  TestTransport$,
} from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { makeFeature } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import type { TransportRef } from '@nestling/pipeline';
import { events, multipart, Ok, stream, upload } from '@nestling/pipeline';
import { z } from 'zod';

const Tick = z.object({ at: z.string() });

async function* noTicks(): AsyncIterableIterator<{ at: string }> {
  // намеренно пуст
}

/** Объявляет готовый инстанс транспорта экземпляром по умолчанию */
const asTransport = (token: TransportRef, transport: ITransport) =>
  transportValue(token, transport);

describe('capability-валидация через assemble', () => {
  it('форма вне способностей падает на сборке, называя endpoint, единицу, слот и форму', async () => {
    const Watch = testEndpoint({
      method: 'GET',
      path: '/watch',
      output: events(Tick),
      handler: async () => new Ok(noTicks()),
    });

    const app = makeApp({
      features: [makeFeature({ name: 'module:watch', endpoints: [Watch] })],
      transports: [asTransport(TestTransport$('default'), new MockTransport())],
    }).assemble();

    await expect(app.run()).rejects.toThrow(
      /Endpoint 'GET \/watch' declared in 'module:watch': transport 'test' does not support form 'events' in 'output'/,
    );
  });

  it('multipart на транспорте без него падает и через assemble', async () => {
    const Upload = testEndpoint({
      method: 'POST',
      path: '/upload',
      input: multipart({ files: { blob: upload() } }),
      handler: async () => new Ok({ ok: true }),
    });

    const app = makeApp({
      features: [makeFeature({ name: 'module:upload', endpoints: [Upload] })],
      transports: [asTransport(TestTransport$('default'), new MockTransport())],
    }).assemble();

    await expect(app.run()).rejects.toThrow(
      /does not support form 'multipart' in 'input' \(supported: value\)/,
    );
  });

  it('поддерживаемая форма проходит сборку и старт приёма запросов', async () => {
    const Export = testEndpoint({
      method: 'GET',
      path: '/export',
      output: stream(Tick),
      handler: async () => new Ok(noTicks()),
    });

    const transport = new MockTransport(undefined, ALL_FORMS);

    const app = makeApp({
      features: [makeFeature({ name: 'module:export', endpoints: [Export] })],
      transports: [asTransport(TestTransport$('default'), transport)],
    }).assemble();

    await app.run();

    expect(transport.serving).toBe(true);

    await app.close();
  });

  it('транспорт не начинает принимать запросы при несовместимой декларации', async () => {
    const Live = testEndpoint({
      method: 'GET',
      path: '/live',
      output: events(Tick),
      handler: async () => new Ok(noTicks()),
    });

    // Транспорт умеет только value-формы — как шина портов в V1
    const bus = new MockTransport();

    const app = makeApp({
      features: [makeFeature({ name: 'module:live', endpoints: [Live] })],
      transports: [asTransport(TestTransport$('default'), bus)],
    }).assemble();

    await expect(app.run()).rejects.toThrow(/does not support form 'events'/);
    expect(bus.serving).toBe(false);
    expect(bus.routes).toHaveLength(0);
  });
});
