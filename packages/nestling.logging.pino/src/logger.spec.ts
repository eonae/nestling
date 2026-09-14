/**
 * Адаптер pino: формы вызова, привязки, порог, форматы и занятые ключи.
 *
 * Записи читаются перехватом `process.stderr.write` — тем же способом,
 * что и у штатного логгера: это единственное место пакета, которое пишет
 * в поток процесса.
 *
 * Отдельная группа сверяет вывод с штатным логгером: формат `text`
 * обещан общим, и обещание проверяется одной последовательностью вызовов
 * через оба логгера.
 */

import type { PinoLoggerOptions } from './logger.js';
import { pinoLogger } from './logger.js';
import { makeDestination } from './writer.js';

import type { Logger, LogLevel } from '@nestlingjs/logging';
import { makeConsoleLogger } from '@nestlingjs/logging';
import { describe, expect, it, vi } from 'vitest';

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** Перехватывает строки, ушедшие в `stderr`, на время вызова */
function capture(body: () => void): string[] {
  const lines: string[] = [];
  const spy = vi
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

const json = (level: LogLevel = 'debug'): Logger =>
  pinoLogger({ level, format: 'json' });

const text = (level: LogLevel = 'debug'): Logger =>
  pinoLogger({ level, format: 'text' });

describe('pinoLogger: формы вызова', () => {
  it.each(LEVELS)('%s(message, fields)', (level) => {
    const record = single(() =>
      json()[level]('database connected', { host: 'db' }),
    );

    expect(record).toMatchObject({
      level,
      msg: 'database connected',
      host: 'db',
    });
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
  });

  it.each(LEVELS)('%s(fields) — запись без сообщения', (level) => {
    const record = single(() => json()[level]({ rows: 3 }));

    expect(record).toMatchObject({ level, rows: 3 });
    expect(record).not.toHaveProperty('msg');
  });

  it('поля второго аргумента не перекрывают ошибку', () => {
    const record = single(() =>
      json().error(new Error('real'), { err: 'fake' }),
    );

    expect(record.err).toMatchObject({ name: 'Error', message: 'real' });
  });

  it('методы уровня можно передавать отвязанными от экземпляра', () => {
    const { info } = json();

    expect(single(() => info('detached'))).toMatchObject({ msg: 'detached' });
  });
});

describe('pinoLogger: привязки', () => {
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

  it('привязки идут в строке раньше полей вызова', () => {
    const child = json().child({ scope: 'users' });
    const record = single(() => child.info('created', { id: 7 }));

    expect(Object.keys(record)).toEqual([
      'level',
      'time',
      'scope',
      'id',
      'msg',
    ]);
  });
});

describe('pinoLogger: порог', () => {
  it('умолчание — info', () => {
    const logger = pinoLogger({ format: 'json' });

    expect(capture(() => logger.debug('hidden'))).toEqual([]);
    expect(capture(() => logger.info('shown'))).toHaveLength(1);
  });

  it('уровень pino trace отображается на debug', () => {
    const logger = pinoLogger({ level: 'trace', format: 'json' });

    expect(capture(() => logger.debug('x'))).toHaveLength(1);
  });

  it('уровень pino fatal отображается на error', () => {
    const logger = pinoLogger({ level: 'fatal', format: 'json' });

    expect(capture(() => logger.warn('x'))).toEqual([]);
    expect(capture(() => logger.error('y'))).toHaveLength(1);
  });

  it('порог silent отсекает все четыре уровня', () => {
    const logger = pinoLogger({ level: 'silent', format: 'json' });

    expect(
      capture(() => {
        for (const level of LEVELS) {
          logger[level]('x');
        }
      }),
    ).toEqual([]);
  });

  it('дочерний логгер молчащего логгера тоже молчит', () => {
    const child = pinoLogger({ level: 'silent' }).child({ scope: 'users' });

    expect(capture(() => child.error('x'))).toEqual([]);
  });
});

describe('pinoLogger: формат json', () => {
  it('time — строка ISO, level — метка, полей процесса нет', () => {
    const record = single(() => json().warn('ready'));

    expect(new Date(record.time as string).toISOString()).toBe(record.time);
    expect(record.level).toBe('warn');
    expect(record.msg).toBe('ready');
    expect(record).not.toHaveProperty('pid');
    expect(record).not.toHaveProperty('hostname');
  });

  it('err — объект с name, message, stack и cause', () => {
    const error = new Error('outer', { cause: new TypeError('inner') });
    const record = single(() => json().error(error));

    expect(record.err).toMatchObject({
      name: 'Error',
      message: 'outer',
      cause: { name: 'TypeError', message: 'inner' },
    });
    expect(typeof (record.err as { stack: unknown }).stack).toBe('string');
  });

  it('err, который не является ошибкой, отдаётся как есть', () => {
    const record = single(() =>
      json().error('rejected', { err: { code: 'x', status: 400 } }),
    );

    expect(record.err).toEqual({ code: 'x', status: 400 });
  });
});

/** Опции pino мимо типа: `Omit` снял ключ, но JavaScript типов не знает */
const withPino = (options: Record<string, unknown>): Logger =>
  pinoLogger({ pino: options as PinoLoggerOptions['pino'] });

/** Ключи pino, которые задаёт адаптер */
const OWNED = [
  'base',
  'errorKey',
  'formatters',
  'level',
  'messageKey',
  'timestamp',
  'transport',
];

describe('pinoLogger: ключи, занятые адаптером', () => {
  it.each(OWNED)('%s даёт TypeError с именем ключа и заменой', (key) => {
    expect(() => withPino({ [key]: false })).toThrow(
      new RegExp(`^pino\\.${key} is set by the adapter: .+`),
    );
    expect(() => withPino({ [key]: false })).toThrow(TypeError);
  });

  it('тип снимает занятый ключ с поля pino', () => {
    expect(() =>
      // @ts-expect-error — `timestamp` занят адаптером, и тип его не принимает
      pinoLogger({ pino: { timestamp: false } }),
    ).toThrow(TypeError);
  });

  it('вложенный serializers.err назван в отказе полным путём', () => {
    expect(() => withPino({ serializers: { err: (e: unknown) => e } })).toThrow(
      /^pino\.serializers\.err is set by the adapter: /,
    );
  });

  it('сериализатор другого ключа доходит до библиотеки', () => {
    const record = single(() =>
      pinoLogger({
        format: 'json',
        pino: { serializers: { user: (u: { id: number }) => u.id } },
      }).info('x', { user: { id: 7, secret: 'keep out' } }),
    );

    expect(record.user).toBe(7);
  });

  it('redact доходит до библиотеки', () => {
    const record = single(() =>
      pinoLogger({ format: 'json', pino: { redact: ['password'] } }).info('x', {
        password: 'hunter2',
      }),
    );

    expect(record.password).toBe('[Redacted]');
  });
});

/** Одна и та же последовательность вызовов через любой логгер */
function sequence(logger: Logger, error: Error): void {
  logger.info('ok', { n: 1, name: 'ann' });
  logger.child({ scope: 'users', region: 'eu' }).info('created', { id: 7 });
  logger.warn({ rows: 3 });
  logger.error(error, { host: 'db' });
  logger.info('x', { list: ['a', 'b'], obj: { k: 1 }, s: 'two words' });
}

/** Время у двух логгеров своё; сравнивается всё остальное */
const withoutTime = (lines: string[]): string[] =>
  lines.map((line) =>
    line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/, 'TIME'),
  );

describe('pinoLogger: формат text совпадает со штатным логгером', () => {
  it('строки совпадают посимвольно, кроме времени', () => {
    const error = new Error('outer', { cause: new TypeError('inner') });

    const fromPino = capture(() => sequence(text(), error));
    const fromConsole = capture(() =>
      sequence(makeConsoleLogger({ level: 'debug', format: 'text' }), error),
    );

    expect(fromPino).toHaveLength(5);
    expect(withoutTime(fromPino)).toEqual(withoutTime(fromConsole));
  });
});

describe('писатель в stderr', () => {
  it('строка, которую не разобрать, уходит как есть', () => {
    const destination = makeDestination('text');
    const [line] = capture(() => {
      destination.write('not json at all\n');
    });

    expect(line).toBe('not json at all\n');
  });

  it('в json строка pino уходит без разбора', () => {
    const destination = makeDestination('json');
    const line = '{"level":"info","time":"2026-09-14T10:00:00.000Z"}\n';

    expect(capture(() => destination.write(line))).toEqual([line]);
  });
});
