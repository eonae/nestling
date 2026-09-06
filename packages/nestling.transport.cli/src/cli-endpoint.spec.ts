/**
 * Конструктор CLI-деклараций и обслуживание команды транспортом.
 */

import { cliEndpoint, CliTransport, CliTransport$ } from './index.js';

import { describe, expect, it, jest } from '@jest/globals';
import type { Fields, Logger, LogLevel } from '@nestling/app';
import {
  isEndpointDefinition,
  makeDispatch,
  makeFail,
  makePipeline,
  Ok,
  transportNameOf,
} from '@nestling/app';
import { z } from 'zod';

/** Логгер-шпион: записи ядра копятся значениями, а не уходят в stderr */
function spyLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const make = (bindings: Fields): Logger => {
    const write =
      (level: LogLevel) =>
      (first: string | Error | Fields, second?: Fields): void => {
        if (typeof first === 'string') {
          entries.push({
            level,
            message: first,
            fields: { ...bindings, ...second },
          });
        } else if (first instanceof Error) {
          entries.push({
            level,
            message: first.message,
            fields: { ...bindings, ...second, err: first },
          });
        } else {
          entries.push({
            level,
            message: '',
            fields: { ...bindings, ...first },
          });
        }
      };

    return {
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
      child: (extra) => make({ ...bindings, ...extra }),
    };
  };

  return { logger: make({}), entries };
}

interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: Fields;
}

describe('cliEndpoint', () => {
  it("имя команды становится паттерном endpoint'а", () => {
    const ProcessStdin = cliEndpoint({
      command: 'process-stdin',
      output: z.object({ lines: z.number() }),
      handler: async () => new Ok({ lines: 0 }),
    });

    // Ссылка на транспорт — DI-токен; строковое имя выводится из его id
    expect(ProcessStdin.transport).toBe(CliTransport$('default'));
    expect(transportNameOf(ProcessStdin.transport)).toBe('cli');
    expect(ProcessStdin.pattern).toBe('process-stdin');
    expect(isEndpointDefinition(ProcessStdin)).toBe(true);
  });

  it('пустое имя команды — ошибка в момент создания', () => {
    expect(() =>
      cliEndpoint({ command: '', handler: async () => new Ok({}) }),
    ).toThrow(/'command' must be a non-empty name/);
  });

  it('detached передаётся в значение декларации, пустая причина отвергается', () => {
    const reason = 'служебная команда обслуживания: политик auth не касается';

    const Vacuum = cliEndpoint({
      command: 'vacuum',
      detached: reason,
      handler: async () => new Ok({}),
    });

    expect(Vacuum.detached).toBe(reason);

    expect(() =>
      cliEndpoint({
        command: 'vacuum',
        detached: '',
        handler: async () => new Ok({}),
      }),
    ).toThrow(/'detached' must state a reason/);
  });

  it('CliTransport обслуживает объявленную команду', async () => {
    const Greet = cliEndpoint({
      command: 'greet',
      output: z.object({ message: z.string() }),
      pipeline: makePipeline(),
      handler: async () => new Ok({ message: 'hello' }),
    });

    const cli = new CliTransport({ argv: [] });
    await cli.serve(makeDispatch([Greet]), new AbortController().signal);

    const response = await cli.execute({
      command: 'greet',
      args: [],
      options: {},
    });

    expect(response).toMatchObject({
      isSuccess: true,
      value: { message: 'hello' },
    });

    await cli.close();
  });

  it('заголовки Ok отбрасываются: в stdout уходит только значение', async () => {
    const Greet = cliEndpoint({
      command: 'greet',
      output: z.object({ message: z.string() }),
      pipeline: makePipeline(),
      handler: async () =>
        new Ok({ message: 'hello' }, { 'X-Trace': 'trace-1' }),
    });

    const printed: string[] = [];
    const log = jest
      .spyOn(console, 'log')
      .mockImplementation((line: string) => void printed.push(line));

    try {
      const cli = new CliTransport({ argv: ['greet'] });
      await cli.serve(makeDispatch([Greet]), new AbortController().signal);
      await cli.close();
    } finally {
      log.mockRestore();
    }

    expect(printed).toHaveLength(1);
    expect(JSON.parse(printed[0])).toEqual({ message: 'hello' });
    expect(printed[0]).not.toContain('X-Trace');
  });

  it('класс-хендлер обслуживается после получения зависимостей', async () => {
    class Clock {
      now() {
        return 'fixed';
      }
    }

    class NowHandler {
      constructor(private readonly clock: Clock) {}

      async handle() {
        return new Ok({ now: this.clock.now() });
      }
    }

    const Now = cliEndpoint({
      command: 'now',
      output: z.object({ now: z.string() }),
      pipeline: makePipeline(),
      handler: NowHandler,
    });

    const cli = new CliTransport({ argv: [] });
    await cli.serve(
      makeDispatch([Now.resolve(() => new NowHandler(new Clock()))]),
      new AbortController().signal,
    );

    const response = await cli.execute({
      command: 'now',
      args: [],
      options: {},
    });

    expect(response).toMatchObject({
      isSuccess: true,
      value: { now: 'fixed' },
    });

    await cli.close();
  });
});

describe('cliEndpoint — объявленные отказы', () => {
  const TooManyLines = makeFail('too_many_requests:too_many_lines', {
    details: z.object({ limit: z.number() }),
    message: (d) => `Only ${d.limit} lines allowed`,
  });

  it('errors: доходит до значения декларации и до проверки границы', async () => {
    const Count = cliEndpoint({
      command: 'count',
      output: z.object({ lines: z.number() }),
      pipeline: makePipeline(),
      errors: [TooManyLines],
      handler: async () => TooManyLines({ limit: 10 }),
    });

    expect(Count.errors).toEqual([TooManyLines]);

    const cli = new CliTransport({ argv: [] });
    await cli.serve(makeDispatch([Count]), new AbortController().signal);

    const response = await cli.execute({
      command: 'count',
      args: [],
      options: {},
    });

    // Статус печатается как есть: в отличие от HTTP, сопоставлять его
    // с кодом ответа не нужно
    expect(response).toMatchObject({
      isSuccess: false,
      status: 'too_many_requests',
      value: {
        code: 'too_many_requests:too_many_lines',
        details: { limit: 10 },
      },
    });

    await cli.close();
  });

  it('незадекларированный отказ нормализуется, хук получает оригинал', async () => {
    const Count = cliEndpoint({
      command: 'count',
      output: z.object({ lines: z.number() }),
      pipeline: makePipeline(),
      handler: async () => {
        throw TooManyLines({ limit: 10 });
      },
    });

    const spy = spyLogger();
    const cli = new CliTransport({ argv: [] });
    await cli.serve(
      makeDispatch([Count], { logger: spy.logger }),
      new AbortController().signal,
    );

    const response = await cli.execute({
      command: 'count',
      args: [],
      options: {},
    });

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'internal_error',
      value: { code: 'internal_error' },
    });
    expect(spy.entries).toEqual([
      {
        level: 'error',
        message: 'undeclared fail normalized to internal_error',
        fields: {
          transport: 'cli',
          pattern: 'count',
          code: expect.any(String),
          err: expect.objectContaining({ message: expect.any(String) }),
        },
      },
    ]);

    await cli.close();
  });
});
