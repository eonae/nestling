/**
 * `ConsoleLogger`: формы вызова, фильтр уровня, форматы, `requestId`.
 *
 * Записи читаются перехватом `process.stderr.write`: это единственное
 * место ядра, которое пишет в поток процесса, и тест проверяет именно
 * его.
 */

import { makeCell, runInScope } from '../pipeline/core/context/store.js';

import { ConsoleLogger, defaultLogger } from './console.js';
import type { LogLevel } from './interface.js';

import { jest } from '@jest/globals';
import { makeFail } from '@nestlingjs/operations';

const UserNotFound = makeFail('not_found:user', { message: 'User not found' });

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** Перехватывает строки, ушедшие в `stderr`, на время вызова */
function capture(body: () => void): string[] {
  const lines: string[] = [];
  const spy = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));

      return true;
    });

  try {
    body();
  } finally {
    spy.mockRestore();
  }

  return lines;
}

/** Единственная JSON-запись, ушедшая в `stderr` */
function single(body: () => void): Record<string, unknown> {
  const lines = capture(body);

  expect(lines).toHaveLength(1);

  return JSON.parse(lines[0]) as Record<string, unknown>;
}

const json = (level: LogLevel = 'debug'): ConsoleLogger =>
  new ConsoleLogger({ level, format: 'json' });

const text = (level: LogLevel = 'debug'): ConsoleLogger =>
  new ConsoleLogger({ level, format: 'text' });

describe('ConsoleLogger: формы вызова', () => {
  it.each(LEVELS)('%s(message, fields)', (level) => {
    const record = single(() =>
      json()[level]('database connected', { host: 'db' }),
    );

    expect(record).toMatchObject({
      level,
      msg: 'database connected',
      host: 'db',
    });
    expect(typeof record.time).toBe('string');
  });

  it.each(LEVELS)('%s(error, fields) берёт сообщение из ошибки', (level) => {
    const record = single(() =>
      json()[level](new Error('boom'), { operation: 'x' }),
    );

    expect(record).toMatchObject({
      level,
      msg: 'boom',
      operation: 'x',
      err: { name: 'Error', message: 'boom' },
    });
    expect(typeof (record.err as { stack: unknown }).stack).toBe('string');
  });

  it.each(LEVELS)('%s(fields) — запись без сообщения', (level) => {
    const record = single(() => json()[level]({ rows: 3 }));

    expect(record).toMatchObject({ level, rows: 3 });
    expect(record).not.toHaveProperty('msg');
  });

  it('отказ проходит формой ошибки', () => {
    const fail = UserNotFound();
    const record = single(() => json().warn(fail));

    expect(record).toMatchObject({
      level: 'warn',
      msg: fail.message,
      err: { name: fail.name, message: fail.message },
    });
  });

  it('методы уровня можно передавать отвязанными от экземпляра', () => {
    const { info } = json();

    expect(single(() => info('detached'))).toMatchObject({ msg: 'detached' });
  });
});

describe('ConsoleLogger: привязки и уровень', () => {
  it('child добавляет привязки; поля вызова кладутся поверх', () => {
    const child = json().child({ scope: 'users', region: 'eu' });
    const record = single(() => child.info('ok', { scope: 'override', n: 1 }));

    expect(record).toMatchObject({
      scope: 'override',
      region: 'eu',
      msg: 'ok',
      n: 1,
    });
  });

  it('привязки дочернего логгера накладываются поверх родительских', () => {
    const grandchild = json().child({ a: 1, b: 1 }).child({ b: 2 });

    expect(single(() => grandchild.info('x'))).toMatchObject({ a: 1, b: 2 });
  });

  it('запись ниже порога отбрасывается', () => {
    const logger = json('warn');

    expect(capture(() => logger.debug('x'))).toEqual([]);
    expect(capture(() => logger.info('x'))).toEqual([]);
    expect(capture(() => logger.warn('y'))).toHaveLength(1);
    expect(capture(() => logger.error('z'))).toHaveLength(1);
  });
});

describe('ConsoleLogger: формат json', () => {
  it('строка разбирается и несёт time, level, scope, msg, поля и err', () => {
    const logger = json().child({ scope: 'users' });
    const record = single(() =>
      logger.error('failed', { id: '1', err: new Error('boom') }),
    );

    expect(Object.keys(record)).toEqual([
      'time',
      'level',
      'scope',
      'msg',
      'id',
      'err',
    ]);
    expect(record).toMatchObject({
      level: 'error',
      scope: 'users',
      msg: 'failed',
      id: '1',
      err: { name: 'Error', message: 'boom' },
    });
    expect(new Date(record.time as string).toISOString()).toBe(record.time);
  });

  it('cause ошибки сериализуется рекурсивно', () => {
    const error = new Error('outer', { cause: new TypeError('inner') });
    const record = single(() => json().error(error));

    expect(record.err).toMatchObject({
      name: 'Error',
      message: 'outer',
      cause: { name: 'TypeError', message: 'inner' },
    });
  });

  it('err, который не является ошибкой, отдаётся как есть', () => {
    const record = single(() =>
      json().error('rejected', { err: { code: 'x', status: 400 } }),
    );

    expect(record.err).toEqual({ code: 'x', status: 400 });
  });

  it('циклическая ссылка в поле не роняет запись', () => {
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;

    const record = single(() => json().info('x', { loop }));

    expect(record.loop).toEqual({ name: 'loop', self: '[Circular]' });
  });

  it('bigint в поле записывается строкой', () => {
    expect(single(() => json().info('x', { big: 10n }))).toMatchObject({
      big: '10',
    });
  });
});

describe('ConsoleLogger: формат text', () => {
  const TIME = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z`;

  it('строка: время, уровень, scope, сообщение, key=value', () => {
    const logger = text().child({ scope: 'users' });
    const [line] = capture(() => logger.info('ok', { n: 1, name: 'ann' }));

    expect(line).toMatch(new RegExp(`^${TIME} INFO  users ok n=1 name=ann\n$`));
  });

  it('без scope и без сообщения печатаются только поля', () => {
    const [line] = capture(() => text().warn({ rows: 3 }));

    expect(line).toMatch(new RegExp(`^${TIME} WARN  rows=3\n$`));
  });

  it('объекты, массивы и строки с пробелами — через JSON', () => {
    const [line] = capture(() =>
      text().info('x', { list: ['a', 'b'], obj: { k: 1 }, s: 'two words' }),
    );

    expect(line).toContain(' list=["a","b"] obj={"k":1} s="two words"\n');
  });

  it('err — имя и сообщение, стек на следующих строках', () => {
    const error = new Error('boom');
    const [line] = capture(() => text().error(error));

    expect(line).toMatch(
      new RegExp(`^${TIME} ERROR boom err=Error: boom\n    at `),
    );
    expect(line.endsWith('\n')).toBe(true);
  });

  it('cause печатается после стека', () => {
    const error = new Error('outer', { cause: new Error('inner') });
    const [line] = capture(() => text().error(error));

    expect(line).toContain('\n    caused by: Error: inner');
  });

  it('умолчание для standalone-путей: уровень info, формат text', () => {
    expect(capture(() => defaultLogger.debug('hidden'))).toEqual([]);

    const [line] = capture(() => defaultLogger.info('shown'));

    expect(line).toMatch(new RegExp(`^${TIME} INFO  shown\n$`));
  });
});

describe('ConsoleLogger: идентификатор запроса', () => {
  // Логгер читает `requestId` из ambient-контекста напрямую: корень
  // существует раньше графа, поэтому узла-ридера у него нет
  it('внутри области запроса запись несёт requestId', () => {
    const logger = new ConsoleLogger({ level: 'info', format: 'json' });
    const cell = makeCell(new AbortController().signal, {
      requestId: 'req-42',
    });

    const record = single(() => runInScope(cell, () => logger.info('select')));

    expect(record).toMatchObject({ requestId: 'req-42', msg: 'select' });
  });

  it('поле вызова важнее значения из контекста', () => {
    const logger = new ConsoleLogger({ level: 'info', format: 'json' });
    const cell = makeCell(new AbortController().signal, {
      requestId: 'req-42',
    });

    const record = single(() =>
      runInScope(cell, () => logger.info('select', { requestId: 'mine' })),
    );

    expect(record.requestId).toBe('mine');
  });

  it('вне запроса поля нет', () => {
    const logger = new ConsoleLogger({ level: 'info', format: 'json' });

    expect(single(() => logger.info('started'))).not.toHaveProperty(
      'requestId',
    );
  });

  it('дочерний логгер читает тот же контекст', () => {
    const child = new ConsoleLogger({ level: 'info', format: 'json' }).child({
      scope: 'users',
    });
    const cell = makeCell(new AbortController().signal, { requestId: 'req-1' });

    const record = single(() => runInScope(cell, () => child.info('x')));

    expect(record).toMatchObject({ scope: 'users', requestId: 'req-1' });
  });
});
