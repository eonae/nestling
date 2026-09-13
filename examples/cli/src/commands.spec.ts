/**
 * Команды выполняются через `execute`: аргументы разбирает `parseArgv`,
 * stdout не участвует.
 *
 * Сервис не поднимается: `fetch` подменяется на время прогона. Проверяется
 * то, за что отвечает CLI, — разбор аргументов, вопросы недостающего и
 * разбор ответа сервиса.
 */

import { Readable, Writable } from 'node:stream';

import { CreateUser, Help, ListUsers } from './commands/index.js';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { makeDispatch } from '@nestlingjs/app';
import { CliTransport, parseArgv } from '@nestlingjs/transport.cli';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };

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

/** Подменяет `fetch` ответом сервиса; возвращает список ушедших запросов */
function fakeService(body: unknown, status = 200): { calls: Request[] } {
  const calls: Request[] = [];

  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: any, init: any) => {
      calls.push(new Request(String(input), init));

      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    });

  return { calls };
}

describe('команды через execute', () => {
  let cli: CliTransport;

  beforeEach(async () => {
    // Пустой `argv`: `serve` регистрирует команды и ничего не выполняет
    cli = new CliTransport({
      mode: 'argv',
      argv: [],
    });
    await cli.serve(
      makeDispatch([Help, CreateUser, ListUsers]),
      new AbortController().signal,
    );
  });

  afterEach(async () => {
    await cli.close();
    jest.restoreAllMocks();
  });

  it('отдаёт справку потоком строк: печатает её транспорт', async () => {
    const chunks: string[] = [];
    const printing = new CliTransport({
      mode: 'argv',
      argv: [],
      output: collecting(chunks),
    });

    await printing.serve(makeDispatch([Help]), new AbortController().signal);

    // Результат команды уходит на `stdout` транспорта, а не записью лога
    const response = await printing.execute(parseArgv(['help']));

    expect(response.isSuccess).toBe(true);
    expect(chunks.join('')).toContain('create-user');

    await printing.close();
  });

  it('не знает команду, которой нет в dispatch', async () => {
    await expect(cli.execute(parseArgv(['release']))).rejects.toThrow(
      'Command "release" not found',
    );
  });

  it('число из опции делает схема команды', async () => {
    const { calls } = fakeService([alice]);

    const response = await cli.execute(
      parseArgv(['list-users', '--limit', '1']),
    );

    expect(response.isSuccess).toBe(true);
    expect(response.value).toEqual([alice]);
    // Клиент собрал запрос по той же операции, что обслуживает сервис
    expect(calls[0].url).toContain('/users?limit=1');
  });

  it('отказ сервиса доходит до командной строки своим кодом', async () => {
    fakeService(
      {
        type: 'urn:error:conflict:email_taken',
        title: 'Conflict',
        status: 409,
        detail: 'Email already taken',
        details: { email: alice.email },
      },
      409,
    );

    const response = await cli.execute(
      parseArgv([
        'create-user',
        '--name',
        'Alice II',
        '--email',
        alice.email,
        '--check',
      ]),
    );

    expect(response).toMatchObject({
      isSuccess: false,
      value: { code: 'conflict:email_taken' },
    });
  });
});

describe('create-user: недостающее спрашивается', () => {
  it('спрашивает имя, адрес и подтверждение', async () => {
    const printed: string[] = [];
    const { calls } = fakeService(alice, 201);

    // `interactive: true` нужен тесту: подставленный поток ввода
    // терминалом не является, и по среде вопросы не задавались бы
    const cli = new CliTransport({
      mode: 'argv',
      argv: [],
      input: answers('Alice\n', 'alice@example.com\n', 'n\n'),
      output: collecting(printed),
      interactive: true,
    });

    await cli.serve(makeDispatch([CreateUser]), new AbortController().signal);

    try {
      const response = await cli.execute(parseArgv(['create-user']));

      expect(response.value).toEqual(alice);
      expect(printed.join('')).toContain('Имя пользователя');
      expect(calls[0].method).toBe('POST');
    } finally {
      await cli.close();
      jest.restoreAllMocks();
    }
  });

  it('заданное флагом поле не спрашивается', async () => {
    const printed: string[] = [];
    fakeService(alice, 201);

    const cli = new CliTransport({
      mode: 'argv',
      argv: [],
      input: answers('alice@example.com\n', 'n\n'),
      output: collecting(printed),
      interactive: true,
    });

    await cli.serve(makeDispatch([CreateUser]), new AbortController().signal);

    try {
      const response = await cli.execute(
        parseArgv(['create-user', '--name', 'Alice']),
      );

      expect(response.isSuccess).toBe(true);
      expect(printed.join('')).not.toContain('Имя пользователя');
    } finally {
      await cli.close();
      jest.restoreAllMocks();
    }
  });

  it('вне терминала вопросов нет: команда отказывает валидацией', async () => {
    const printed: string[] = [];

    const cli = new CliTransport({
      mode: 'argv',
      argv: [],
      input: answers('Alice\n'),
      output: collecting(printed),
    });

    await cli.serve(makeDispatch([CreateUser]), new AbortController().signal);

    try {
      const response = await cli.execute(parseArgv(['create-user']));

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
