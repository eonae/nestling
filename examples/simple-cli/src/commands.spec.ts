/**
 * Команды выполняются через `execute`: аргументы разбирает `parseArgv`,
 * stdout не участвует.
 */

import { Readable, Writable } from 'node:stream';

import { Deploy, Greet, Help, ProcessStdin } from './commands/index.js';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { makeDispatch } from '@nestlingjs/app';
import { zodConverter } from '@nestlingjs/schema.zod';
import { CliTransport, parseArgv } from '@nestlingjs/transport.cli';

/** Глушит вывод справки в тесте */
const drop = (): void => undefined;

/** Поток ввода из готовых ответов — по строке на вопрос */
const answers = (...lines: readonly string[]): Readable =>
  Readable.from(lines.map((line) => Buffer.from(line)));

/** Поток вывода, копящий записанное */
const collecting = (chunks: string[]): Writable =>
  new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      callback();
    },
  });

describe('команды через execute', () => {
  let cli: CliTransport;

  beforeEach(async () => {
    // Пустой `argv`: `serve` регистрирует команды и ничего не выполняет
    cli = new CliTransport({
      mode: 'argv',
      argv: [],
      converters: [zodConverter()],
    });
    await cli.serve(
      makeDispatch([Help, Greet, Deploy, ProcessStdin]),
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
      value: { code: 'bad_request' },
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
    await expect(cli.execute(parseArgv(['release']))).rejects.toThrow(
      'Command "release" not found',
    );
  });
});

describe('deploy: недостающее спрашивается', () => {
  it('выбор из списка, подтверждение и умолчание по пустому вводу', async () => {
    const printed: string[] = [];

    // `interactive: true` нужен тесту: подставленный поток ввода
    // терминалом не является, и по среде вопросы не задавались бы
    const cli = new CliTransport({
      mode: 'argv',
      argv: [],
      input: answers('2\n', 'y\n', '\n'),
      output: collecting(printed),
      interactive: true,
      converters: [zodConverter()],
    });

    await cli.serve(makeDispatch([Deploy]), new AbortController().signal);

    try {
      const response = await cli.execute(parseArgv(['deploy']));

      expect(response.value).toEqual({
        env: 'prod',
        host: 'localhost',
        forced: true,
      });
      expect(printed.join('')).toContain('  2) prod');
    } finally {
      await cli.close();
    }
  });

  it('заданное флагом поле не спрашивается', async () => {
    const printed: string[] = [];

    const cli = new CliTransport({
      mode: 'argv',
      argv: [],
      input: answers('n\n', '\n'),
      output: collecting(printed),
      interactive: true,
      converters: [zodConverter()],
    });

    await cli.serve(makeDispatch([Deploy]), new AbortController().signal);

    try {
      const response = await cli.execute(parseArgv(['deploy', '--env', 'dev']));

      expect(response.value).toEqual({
        env: 'dev',
        host: 'localhost',
        forced: false,
      });
      expect(printed.join('')).not.toContain('1) dev');
    } finally {
      await cli.close();
    }
  });

  it('вне терминала вопросов нет: команда отказывает валидацией', async () => {
    const printed: string[] = [];

    const cli = new CliTransport({
      mode: 'argv',
      argv: [],
      input: answers('2\n', 'y\n', '\n'),
      output: collecting(printed),
      converters: [zodConverter()],
    });

    await cli.serve(makeDispatch([Deploy]), new AbortController().signal);

    try {
      const response = await cli.execute(parseArgv(['deploy']));

      expect(response).toMatchObject({
        isSuccess: false,
        value: { code: 'bad_request' },
      });
      expect(printed).toEqual([]);
    } finally {
      await cli.close();
    }
  });
});
