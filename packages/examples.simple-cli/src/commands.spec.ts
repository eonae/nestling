/**
 * Команды выполняются через `execute`: аргументы разбирает `parseArgv`,
 * stdout не участвует.
 */

import { Greet, Help, ProcessStdin } from './commands';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { makeDispatch } from '@nestling/transport';
import { CliTransport, parseArgv } from '@nestling/transport.cli';

/** Глушит вывод справки в тесте */
const drop = (): void => undefined;

describe('команды через execute', () => {
  let cli: CliTransport;

  beforeEach(async () => {
    // Пустой `argv`: `serve` регистрирует команды и ничего не выполняет
    cli = new CliTransport({ mode: 'argv', argv: [] });
    await cli.serve(
      makeDispatch([Help, Greet, ProcessStdin]),
      new AbortController().signal,
    );
  });

  afterEach(async () => {
    await cli.close();
  });

  it('собирает вход из позиционного аргумента и флага', async () => {
    const response = await cli.execute(
      parseArgv(['greet', 'Alice', '--shout']),
    );

    expect(response.isSuccess).toBe(true);
    expect(response.value).toEqual({ greeting: 'HELLO, ALICE!' });
  });

  it('без флага оставляет регистр как есть', async () => {
    const response = await cli.execute(parseArgv(['greet', 'Alice']));

    expect(response.value).toEqual({ greeting: 'Hello, Alice!' });
  });

  it('отказывает по схеме, когда имени нет', async () => {
    const response = await cli.execute(parseArgv(['greet']));

    expect(response).toMatchObject({
      isSuccess: false,
      value: { code: 'VALIDATION_FAILED' },
    });
  });

  it('печатает справку и возвращает подтверждение', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(drop);

    const response = await cli.execute(parseArgv(['help']));

    expect(response.value).toEqual({ message: 'Help displayed' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('greet'));
    log.mockRestore();
  });

  it('не знает команду, которой нет в dispatch', async () => {
    await expect(cli.execute(parseArgv(['deploy']))).rejects.toThrow(
      'Command "deploy" not found',
    );
  });
});
