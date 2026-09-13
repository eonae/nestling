/**
 * Инварианты сборки, которые держит ядро, а не пакет.
 *
 * Два инструмента с одним именем, инструмент с потоковой формой и два
 * транспорта, каждый со своим сервером имени `'default'`, должны валить
 * сборку до INIT и до открытия сокета. Ничего из этого пакет не проверяет
 * сам: уникальность паттерна, формы io и имена серверов — правила ядра, и
 * проверяются они на фазе BUILD.
 */

import { mcpTool } from './tool.js';
import { mcp } from './transport.js';

import { describe, expect, it } from '@jest/globals';
import type { AnyEndpointDefinition } from '@nestlingjs/app';
import {
  makeApp,
  makeFeature,
  objectSource,
  Ok,
  stream,
} from '@nestlingjs/app';
import { zodConverter } from '@nestlingjs/schema.zod';
import { http, serverKeys } from '@nestlingjs/transport.http';
import { z } from 'zod';

const socket = objectSource(
  { HTTP_PORT: '0', HTTP_HOST: '127.0.0.1' },
  'build-socket',
);

/**
 * Проводит приложение по фазам 0 и 1 и останавливается.
 *
 * `build()` строит план и ничего не проверяет; проверки сборки идут в
 * BUILD, и `check()` — самый короткий путь к ним.
 */
const checkWith = (endpoints: readonly AnyEndpointDefinition[]) =>
  makeApp({
    features: [makeFeature({ name: 'tools', endpoints: [...endpoints] })],
    transports: [
      mcp({
        info: { name: 'spec-server', version: '1.0.0' },
        converters: [zodConverter()],
      }),
    ],
    config: [[socket, serverKeys()]],
  }).check();

describe('уникальность имени инструмента', () => {
  it('два инструмента с одним именем валят сборку', async () => {
    const first = mcpTool('same_name', {
      description: 'Первый.',
      output: z.object({ n: z.number() }),
      handler: () => new Ok({ n: 1 }),
    });

    const second = mcpTool('same_name', {
      description: 'Второй.',
      output: z.object({ n: z.number() }),
      handler: () => new Ok({ n: 2 }),
    });

    await expect(checkWith([first, second])).rejects.toThrow(/same_name/);
  });
});

describe('формы io инструмента', () => {
  it('инструмент с потоковой формой выхода отвергается', async () => {
    const Streaming = mcpTool('stream_users', {
      description: 'Отдаёт поток.',
      output: stream(z.object({ id: z.string() })),
      handler: async function* () {
        yield { id: 'u-1' };
      },
    });

    await expect(checkWith([Streaming])).rejects.toThrow(/stream/i);
  });
});

describe('общий сервер двух транспортов', () => {
  it('`http()` и `mcp()` без общего сервера валят сборку именем', () => {
    // Каждая фабрика без опции `server` объявляет свой сервер именем
    // транспорта, и оба здесь — `'default'`: один порт, два объявления
    expect(() =>
      makeApp({
        features: [makeFeature({ name: 'tools', endpoints: [] })],
        transports: [
          http(),
          mcp({
            info: { name: 'spec-server', version: '1.0.0' },
            converters: [zodConverter()],
          }),
        ],
        config: [[socket, serverKeys()]],
      }),
    ).toThrow(/Two different server declarations are named 'default'/);
  });
});
