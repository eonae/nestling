/**
 * Конструктор CLI-деклараций и обслуживание команды транспортом.
 */

import { cliEndpoint, CliTransport } from './index';

import { describe, expect, it } from '@jest/globals';
import { isEndpointDefinition, makePipeline, Ok } from '@nestling/pipeline';
import { z } from 'zod';

describe('cliEndpoint', () => {
  it('имя команды становится паттерном ручки', () => {
    const ProcessStdin = cliEndpoint({
      command: 'process-stdin',
      output: z.object({ lines: z.number() }),
      handle: async () => new Ok({ lines: 0 }),
    });

    expect(ProcessStdin.transport).toBe('cli');
    expect(ProcessStdin.pattern).toBe('process-stdin');
    expect(isEndpointDefinition(ProcessStdin)).toBe(true);
  });

  it('пустое имя команды — ошибка в момент создания', () => {
    expect(() =>
      cliEndpoint({ command: '', handle: async () => new Ok({}) }),
    ).toThrow(/'command' must be a non-empty name/);
  });

  it('CliTransport обслуживает объявленную команду', async () => {
    const Greet = cliEndpoint({
      command: 'greet',
      output: z.object({ message: z.string() }),
      pipeline: makePipeline(),
      handle: async () => new Ok({ message: 'hello' }),
    });

    const cli = new CliTransport();
    cli.endpoint(Greet);

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

  it('декларация с deps обслуживается после гашения', async () => {
    class Clock {
      now() {
        return 'fixed';
      }
    }

    const Now = cliEndpoint({
      command: 'now',
      output: z.object({ now: z.string() }),
      pipeline: makePipeline(),
      deps: [Clock],
      handle: (clock) => async () => new Ok({ now: clock.now() }),
    });

    const cli = new CliTransport();
    cli.endpoint(Now.resolve([new Clock()]));

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
