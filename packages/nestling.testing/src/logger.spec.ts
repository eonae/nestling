import { spyLogger } from './logger.js';

import { describe, expect, it } from '@jest/globals';
import { makeFail } from '@nestlingjs/operations';

const UserNotFound = makeFail('not_found:user', { message: 'User not found' });

describe('spyLogger', () => {
  it('копит записи трёх форм вызова', () => {
    const spy = spyLogger();
    const error = new Error('boom');

    spy.logger.info('started', { port: 3000 });
    spy.logger.error(error, { operation: 'x' });
    spy.logger.debug({ rows: 3 });

    expect(spy.entries).toEqual([
      { level: 'info', message: 'started', fields: { port: 3000 } },
      {
        level: 'error',
        message: 'boom',
        fields: { operation: 'x', err: error },
      },
      { level: 'debug', message: '', fields: { rows: 3 } },
    ]);
  });

  it('отказ проходит формой ошибки', () => {
    const spy = spyLogger();
    const fail = UserNotFound();

    spy.logger.warn(fail);

    expect(spy.entries).toEqual([
      { level: 'warn', message: fail.message, fields: { err: fail } },
    ]);
  });

  it('дочерний логгер пишет в тот же список с объединёнными привязками', () => {
    const spy = spyLogger();

    spy.logger.child({ a: 1 }).warn('x', { b: 2 });
    spy.logger.child({ scope: 'users' }).child({ region: 'eu' }).info('y');

    expect(spy.entries).toEqual([
      { level: 'warn', message: 'x', fields: { a: 1, b: 2 } },
      { level: 'info', message: 'y', fields: { scope: 'users', region: 'eu' } },
    ]);
  });

  it('поля вызова кладутся поверх привязок', () => {
    const spy = spyLogger();

    spy.logger.child({ scope: 'users' }).info('ok', { scope: 'override' });

    expect(spy.entries[0].fields).toEqual({ scope: 'override' });
  });
});
