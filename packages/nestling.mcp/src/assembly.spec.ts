/**
 * Инварианты сборки, которые держит ядро, а не пакет.
 *
 * Два инструмента с одним именем и инструмент с потоковой формой должны
 * валить сборку до INIT и до открытия сокета. Ни того, ни другого пакет не
 * проверяет сам: уникальность паттерна и формы io — правила ядра, и
 * проверяются они на фазе ASSEMBLE.
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
import { httpServerKeys } from '@nestlingjs/transport.http';
import { z } from 'zod';

const socket = objectSource(
  { HTTP_PORT: '0', HTTP_HOST: '127.0.0.1' },
  'assembly-socket',
);

/**
 * Проводит приложение по фазам 0 и 1 и останавливается.
 *
 * `assemble()` строит план и ничего не проверяет; проверки сборки идут в
 * ASSEMBLE, и `check()` — самый короткий путь к ним.
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
    config: [[socket, httpServerKeys()]],
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
