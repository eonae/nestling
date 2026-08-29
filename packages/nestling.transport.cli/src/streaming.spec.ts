/**
 * Потоковый вход и выход CLI и отказ регистрации несовместимых форм.
 *
 * stdin/stdout подменяются на время теста: транспорт читает и пишет
 * реальные каналы процесса, а проверять надо именно его поведение, а не
 * обёртку вокруг него.
 */

import { Readable } from 'node:stream';

import { cliEndpoint, CliTransport } from './index';

import { describe, expect, it } from '@jest/globals';
import type { Outcome, PhasedPipeline } from '@nestling/pipeline';
import {
  events,
  makePipeline,
  multipart,
  Ok,
  stream,
  upload,
} from '@nestling/pipeline';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

const Row = z.object({ id: z.string() });
type Row = z.infer<typeof Row>;

/** Подменяет `process.stdin` готовым потоком; возвращает откат */
function withStdin(content: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  const readable = Readable.from([Buffer.from(content)]);

  Object.defineProperty(process, 'stdin', {
    value: readable,
    configurable: true,
  });

  return () => {
    if (original) {
      Object.defineProperty(process, 'stdin', original);
    }
  };
}

/** Перехватывает `process.stdout.write`; возвращает буфер и откат */
function captureStdout(): { written: string[]; restore: () => void } {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    written.push(
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
    );
    return true;
  }) as typeof process.stdout.write;

  return {
    written,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

/**
 * Пайплайн-наблюдатель исхода — значение, а не инлайн в декларации:
 * канонический стиль, он же обходит схлопывание вывода типа юнита в
 * позиции аргумента.
 */
function observing(record: (outcome: Outcome) => void): PhasedPipeline {
  return makePipeline().finally(record);
}

describe('потоковый вход через stdin', () => {
  it('NDJSON-строки передаются в хендлер валидированными, счётчики растут', async () => {
    const restore = withStdin('{"id":"1"}\n{"id":"2"}\n');
    const summaries: { itemsIn: number }[] = [];

    const Import = cliEndpoint({
      command: 'import',
      input: stream(Row),
      output: z.object({ imported: z.number() }),
      pipeline: makePipeline().finally((_outcome, _res, ctx) => {
        summaries.push({ itemsIn: ctx.summary.itemsIn });
      }),
      handle: async (source: AsyncIterableIterator<Row>) => {
        const ids: string[] = [];
        for await (const row of source) {
          ids.push(row.id);
        }
        return new Ok({ imported: ids.length });
      },
    });

    const cli = new CliTransport({ argv: [] });
    await cli.serve(makeDispatch([Import]), new AbortController().signal);

    try {
      const response = await cli.execute({
        command: 'import',
        args: [],
        options: {},
      });

      expect(response).toMatchObject({
        isSuccess: true,
        value: { imported: 2 },
      });
      expect(summaries).toEqual([{ itemsIn: 2 }]);
    } finally {
      restore();
      await cli.close();
    }
  });

  it('невалидный элемент отказывает kernel-кодом валидации', async () => {
    const restore = withStdin('{"id":"1"}\n{"id":42}\n');

    const Import = cliEndpoint({
      command: 'import',
      input: stream(Row),
      output: z.object({ imported: z.number() }),
      pipeline: makePipeline(),
      handle: async (source: AsyncIterableIterator<Row>) => {
        let imported = 0;
        for await (const row of source) {
          imported += row.id.length > 0 ? 1 : 0;
        }
        return new Ok({ imported });
      },
    });

    const cli = new CliTransport({
      onUnknownFail: (): void => undefined,
    });
    await cli.serve(makeDispatch([Import]), new AbortController().signal);

    try {
      const response = await cli.execute({
        command: 'import',
        args: [],
        options: {},
      });

      expect(response).toMatchObject({
        isSuccess: false,
        status: 'BAD_REQUEST',
        value: { code: 'VALIDATION_FAILED' },
      });
    } finally {
      restore();
      await cli.close();
    }
  });

  it("stream('binary') остаётся рабочей формой: чанки как есть", async () => {
    const restore = withStdin('raw bytes');
    let bytes = 0;

    const Count = cliEndpoint({
      command: 'count-bytes',
      input: stream('binary'),
      output: z.object({ bytes: z.number() }),
      pipeline: makePipeline(),
      handle: async (source: AsyncIterableIterator<Buffer>) => {
        for await (const chunk of source) {
          bytes += chunk.length;
        }
        return new Ok({ bytes });
      },
    });

    const cli = new CliTransport({ argv: [] });
    await cli.serve(makeDispatch([Count]), new AbortController().signal);

    try {
      const response = await cli.execute({
        command: 'count-bytes',
        args: [],
        options: {},
      });

      expect(response).toMatchObject({ isSuccess: true, value: { bytes: 9 } });
    } finally {
      restore();
      await cli.close();
    }
  });
});

describe('потоковый выход в stdout', () => {
  it('элементы уходят NDJSON, а .finally срабатывает после последнего', async () => {
    const outcomes: Outcome[] = [];
    const stdout = captureStdout();

    const Export = cliEndpoint({
      command: 'export',
      output: stream(Row),
      pipeline: observing((outcome) => outcomes.push(outcome)),
      handle: async () =>
        new Ok(
          (async function* (): AsyncIterableIterator<Row> {
            yield { id: '1' };
            yield { id: '2' };
          })(),
        ),
    });

    const cli = new CliTransport({ argv: [] });
    await cli.serve(makeDispatch([Export]), new AbortController().signal);

    try {
      const response = await cli.execute({
        command: 'export',
        args: [],
        options: {},
      });

      // Поток уже отдан в stdout — печатать его ещё раз REPL'у нечего
      expect(response).toMatchObject({ isSuccess: true, value: null });
      expect(stdout.written.join('')).toBe('{"id":"1"}\n{"id":"2"}\n');
      expect(outcomes).toEqual(['completed']);
    } finally {
      stdout.restore();
      await cli.close();
    }
  });
});

describe('отказ регистрации несовместимых форм', () => {
  it('events в output отвергается: у команды нет открытого соединения', async () => {
    const Watch = cliEndpoint({
      command: 'watch',
      output: events(Row),
      pipeline: makePipeline(),
      handle: async () =>
        new Ok(
          (async function* (): AsyncIterableIterator<Row> {
            yield { id: '1' };
          })(),
        ),
    });

    const cli = new CliTransport({ argv: [] });

    await expect(
      cli.serve(makeDispatch([Watch]), new AbortController().signal),
    ).rejects.toThrow(
      /transport 'cli' does not support form 'events' in 'output' \(supported: value, stream\)/,
    );
  });

  it('multipart в input отвергается: файлы приходят путями в аргументах', async () => {
    const Upload = cliEndpoint({
      command: 'upload',
      input: multipart({ files: { report: upload() } }),
      pipeline: makePipeline(),
      handle: async () => new Ok({}),
    });

    const cli = new CliTransport({ argv: [] });

    await expect(
      cli.serve(makeDispatch([Upload]), new AbortController().signal),
    ).rejects.toThrow(
      /transport 'cli' does not support form 'multipart' in 'input'/,
    );
  });
});
